import { join } from 'path';
import type { Client } from 'discord.js';
import type { PrismaClient } from '@prisma/client';
import type { BotModule, ModuleContext, ModuleMetadata } from '../../types/module.types.js';
import { ModuleRegistry } from './ModuleRegistry.js';
import { ModuleLoader, ModuleLoadError } from './ModuleLoader.js';
import { DependencyResolver, CircularDependencyError, MissingDependencyError } from './DependencyResolver.js';
import { MigrationRunner } from '../database/MigrationRunner.js';
import { DatabaseService } from '../database/mysql.js';
import { ModuleEventBus, moduleEventBus } from './ModuleEventBus.js';
import { Logger } from '../../shared/utils/logger.js';

const logger = new Logger('ModuleManager');

/**
 * Module state tracking
 */
interface LoadedModule {
  instance: BotModule;
  metadata: ModuleMetadata;
  loadedAt: Date;
}

/**
 * Options for module manager initialization
 */
export interface ModuleManagerOptions {
  client: Client;
  prisma: PrismaClient;
  modulesPath?: string;
}

/**
 * Central manager for all module lifecycle operations.
 * Handles loading, unloading, enabling/disabling, and hot-reloading modules.
 */
export class ModuleManager {
  private client: Client;
  private prisma: PrismaClient;
  private registry: ModuleRegistry;
  private loader: ModuleLoader;
  private resolver: DependencyResolver;
  private migrationRunner: MigrationRunner;
  private db: DatabaseService;
  private eventBus: ModuleEventBus;

  /** Currently loaded modules */
  private loadedModules: Map<string, LoadedModule> = new Map();

  /** Module dependents map (which modules depend on which) */
  private dependentsMap: Map<string, string[]> = new Map();

  /** Callbacks for when commands need to be registered/unregistered */
  private onCommandsChanged?: (moduleId: string, action: 'register' | 'unregister') => Promise<void>;

  /** Callbacks for when events need to be registered/unregistered */
  private onEventsChanged?: (moduleId: string, action: 'register' | 'unregister') => Promise<void>;

  /** Callback for when module is enabled/disabled for a guild (to update command permissions) */
  private onModuleGuildStateChanged?: (moduleId: string, guildId: string, enabled: boolean) => Promise<void>;

  constructor(options: ModuleManagerOptions) {
    this.client = options.client;
    this.prisma = options.prisma;
    this.registry = new ModuleRegistry(options.modulesPath);
    this.loader = new ModuleLoader();
    this.resolver = new DependencyResolver();
    this.migrationRunner = new MigrationRunner();
    this.db = new DatabaseService();
    this.eventBus = moduleEventBus;
  }

  /**
   * Get the module event bus for inter-module communication
   */
  getEventBus(): ModuleEventBus {
    return this.eventBus;
  }

  /**
   * Set callback for command changes (called by CommandManager)
   */
  setCommandsChangedCallback(
    callback: (moduleId: string, action: 'register' | 'unregister') => Promise<void>
  ): void {
    this.onCommandsChanged = callback;
  }

  /**
   * Set callback for event changes (called by EventManager)
   */
  setEventsChangedCallback(
    callback: (moduleId: string, action: 'register' | 'unregister') => Promise<void>
  ): void {
    this.onEventsChanged = callback;
  }

  /**
   * Set callback for guild-level module state changes (called by CommandManager)
   */
  setModuleGuildStateChangedCallback(
    callback: (moduleId: string, guildId: string, enabled: boolean) => Promise<void>
  ): void {
    this.onModuleGuildStateChanged = callback;
  }

  /**
   * Initialize and load all modules
   */
  async initialize(): Promise<void> {
    logger.info('Initializing module system...');

    // Discover available modules
    await this.registry.discoverModules();

    // Get metadata for valid modules
    const moduleMetadata = this.registry.getModuleMetadata();

    if (moduleMetadata.length === 0) {
      logger.warn('No valid modules found');
      return;
    }

    // Resolve dependencies and get load order
    let resolution;
    try {
      resolution = this.resolver.resolve(moduleMetadata);
    } catch (error) {
      if (error instanceof CircularDependencyError) {
        logger.error(`Circular dependency detected: ${error.cycle.join(' -> ')}`);
        throw error;
      }
      if (error instanceof MissingDependencyError) {
        logger.error(error.message);
        throw error;
      }
      throw error;
    }

    this.dependentsMap = resolution.dependents;

    // Get enabled modules from database
    const dbModules = await this.prisma.module.findMany({
      select: { id: true, enabled: true },
    });
    const enabledMap = new Map(dbModules.map(m => [m.id, m.enabled]));

    // Create a map for quick metadata lookup
    const metadataMap = new Map(moduleMetadata.map(m => [m.id, m]));

    // Load modules in dependency order
    for (const moduleId of resolution.loadOrder) {
      // Get module metadata to check if it's a core module
      const moduleMeta = metadataMap.get(moduleId);
      const isCore = moduleMeta?.isCore ?? false;

      // Check if module should be loaded (default to true for new modules)
      // Core modules are always loaded regardless of database setting
      const shouldLoad = isCore || (enabledMap.get(moduleId) ?? true);

      if (!shouldLoad) {
        logger.info(`Skipping disabled module: ${moduleId}`);
        continue;
      }

      try {
        await this.loadModule(moduleId);
      } catch (error) {
        logger.error(`Failed to load module ${moduleId}:`, error);
        // Continue loading other modules
      }
    }

    logger.info(`Module system initialized. ${this.loadedModules.size} module(s) loaded.`);
  }

  /**
   * Load a specific module
   */
  async loadModule(moduleId: string): Promise<boolean> {
    logger.debug(`Loading module: ${moduleId}`);

    // Check if already loaded
    if (this.loadedModules.has(moduleId)) {
      logger.warn(`Module ${moduleId} is already loaded`);
      return true;
    }

    // Get module path
    const modulePath = this.registry.getModulePath(moduleId);
    if (!modulePath) {
      logger.error(`Module ${moduleId} not found in registry`);
      return false;
    }

    // Check dependencies
    const metadata = this.registry.getModule(moduleId)?.metadata;
    if (metadata) {
      const loadedIds = new Set(this.loadedModules.keys());
      const depCheck = this.resolver.checkDependencies(moduleId, metadata.dependencies, loadedIds);

      if (!depCheck.satisfied) {
        logger.error(`Cannot load ${moduleId}: missing dependencies: ${depCheck.missing.join(', ')}`);
        return false;
      }
    }

    try {
      // Load the module
      const instance = await this.loader.load(moduleId, modulePath);

      // Ensure module exists in database BEFORE running migrations
      // (migrations table has a foreign key constraint on moduleId)
      await this.prisma.module.upsert({
        where: { id: moduleId },
        update: {
          name: instance.metadata.name,
          description: instance.metadata.description,
          version: instance.metadata.version,
          isCore: instance.metadata.isCore,
          isPublic: instance.metadata.isPublic,
        },
        create: {
          id: moduleId,
          name: instance.metadata.name,
          description: instance.metadata.description,
          version: instance.metadata.version,
          isCore: instance.metadata.isCore,
          isPublic: instance.metadata.isPublic,
          enabled: true,
        },
      });

      // Run migrations if module has them
      if (instance.migrationsPath) {
        const migrationsPath = join(modulePath, instance.migrationsPath);
        const migrationsRun = await this.migrationRunner.runMigrations(moduleId, migrationsPath);
        if (migrationsRun > 0) {
          logger.info(`Ran ${migrationsRun} migration(s) for module ${moduleId}`);
        }
      }

      // Create module context
      const context: ModuleContext = {
        client: this.client,
        prisma: this.prisma,
        db: this.db,
        events: this.eventBus,
        isModuleLoaded: (depModuleId: string) => this.isLoaded(depModuleId),
      };

      // Call module's onLoad hook
      await instance.onLoad?.(context);

      // Store loaded module
      this.loadedModules.set(moduleId, {
        instance,
        metadata: instance.metadata,
        loadedAt: new Date(),
      });

      // Update database with final state (loaded successfully)
      await this.prisma.module.update({
        where: { id: moduleId },
        data: {
          enabled: true,
          loadedAt: new Date(),
          lastError: null,
        },
      });

      // Store dependencies
      await this.updateDependencies(moduleId, instance.metadata.dependencies);

      // Notify command manager
      await this.onCommandsChanged?.(moduleId, 'register');

      // Notify event manager
      await this.onEventsChanged?.(moduleId, 'register');

      logger.info(`Module ${moduleId} loaded successfully`);
      return true;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to load module ${moduleId}: ${errorMessage}`);

      // Record error in database
      await this.prisma.module.upsert({
        where: { id: moduleId },
        update: { lastError: errorMessage, enabled: false },
        create: {
          id: moduleId,
          name: moduleId,
          version: '0.0.0',
          enabled: false,
          lastError: errorMessage,
        },
      });

      return false;
    }
  }

  /**
   * Unload a specific module
   */
  async unloadModule(moduleId: string, force: boolean = false): Promise<boolean> {
    const loaded = this.loadedModules.get(moduleId);
    if (!loaded) {
      logger.warn(`Module ${moduleId} is not loaded`);
      return false;
    }

    // Check if this is a core module
    if (loaded.metadata.isCore && !force) {
      logger.error(`Cannot unload core module: ${moduleId}`);
      return false;
    }

    // Check if other modules depend on this one
    const dependents = this.dependentsMap.get(moduleId) || [];
    const loadedDependents = dependents.filter(d => this.loadedModules.has(d));

    if (loadedDependents.length > 0 && !force) {
      logger.error(
        `Cannot unload ${moduleId}: the following modules depend on it: ${loadedDependents.join(', ')}`
      );
      return false;
    }

    try {
      // Notify event manager first (remove listeners)
      await this.onEventsChanged?.(moduleId, 'unregister');

      // Notify command manager (remove commands)
      await this.onCommandsChanged?.(moduleId, 'unregister');

      // Clean up module event bus subscriptions
      this.eventBus.unsubscribeAll(moduleId);

      // Call module's onUnload hook
      await loaded.instance.onUnload?.();

      // Remove from loaded modules
      this.loadedModules.delete(moduleId);

      // Clear loader cache
      this.loader.clearModuleCache(moduleId);

      // Update database
      await this.prisma.module.update({
        where: { id: moduleId },
        data: { enabled: false, loadedAt: null },
      });

      logger.info(`Module ${moduleId} unloaded successfully`);
      return true;

    } catch (error) {
      logger.error(`Error unloading module ${moduleId}:`, error);
      return false;
    }
  }

  /**
   * Reload a module (hot-reload)
   */
  async reloadModule(moduleId: string): Promise<boolean> {
    logger.info(`Hot-reloading module: ${moduleId}`);

    const loaded = this.loadedModules.get(moduleId);
    if (!loaded) {
      logger.warn(`Module ${moduleId} is not loaded, loading it instead`);
      return this.loadModule(moduleId);
    }

    // Call onReload hook
    await loaded.instance.onReload?.();

    // Unload and reload
    const unloaded = await this.unloadModule(moduleId, true);
    if (!unloaded) {
      return false;
    }

    return this.loadModule(moduleId);
  }

  /**
   * Enable a module for a specific guild
   */
  async enableForGuild(moduleId: string, guildId: string): Promise<void> {
    const loaded = this.loadedModules.get(moduleId);
    if (!loaded) {
      throw new Error(`Module ${moduleId} is not loaded`);
    }

    await this.prisma.guildModule.upsert({
      where: { guildId_moduleId: { guildId, moduleId } },
      update: { enabled: true },
      create: { guildId, moduleId, enabled: true },
    });

    // Update command permissions (re-enable commands for this guild)
    await this.onModuleGuildStateChanged?.(moduleId, guildId, true);

    await loaded.instance.onEnable?.(guildId);
    logger.debug(`Module ${moduleId} enabled for guild ${guildId}`);
  }

  /**
   * Disable a module for a specific guild
   */
  async disableForGuild(moduleId: string, guildId: string): Promise<void> {
    const loaded = this.loadedModules.get(moduleId);
    if (!loaded) {
      return;
    }

    if (loaded.metadata.isCore) {
      throw new Error(`Cannot disable core module: ${moduleId}`);
    }

    await this.prisma.guildModule.upsert({
      where: { guildId_moduleId: { guildId, moduleId } },
      update: { enabled: false },
      create: { guildId, moduleId, enabled: false },
    });

    // Update command permissions (disable commands for this guild)
    await this.onModuleGuildStateChanged?.(moduleId, guildId, false);

    await loaded.instance.onDisable?.(guildId);
    logger.debug(`Module ${moduleId} disabled for guild ${guildId}`);
  }

  /**
   * Check if a module is enabled for a guild
   */
  async isEnabledForGuild(moduleId: string, guildId: string): Promise<boolean> {
    const loaded = this.loadedModules.get(moduleId);
    if (!loaded) return false;

    // Core modules are always enabled
    if (loaded.metadata.isCore) return true;

    const guildModule = await this.prisma.guildModule.findUnique({
      where: { guildId_moduleId: { guildId, moduleId } },
    });

    // Default to enabled if no record exists
    return guildModule?.enabled ?? true;
  }

  /**
   * Get a loaded module by ID
   */
  getModule(moduleId: string): BotModule | undefined {
    return this.loadedModules.get(moduleId)?.instance;
  }

  /**
   * Get all loaded modules
   */
  getLoadedModules(): BotModule[] {
    return Array.from(this.loadedModules.values()).map(m => m.instance);
  }

  /**
   * Get all loaded module IDs
   */
  getLoadedModuleIds(): string[] {
    return Array.from(this.loadedModules.keys());
  }

  /**
   * Get public modules (visible to users)
   */
  getPublicModules(): BotModule[] {
    return this.getLoadedModules().filter(m => m.metadata.isPublic);
  }

  /**
   * Check if a module is loaded
   */
  isLoaded(moduleId: string): boolean {
    return this.loadedModules.has(moduleId);
  }

  /**
   * Get all discovered modules (including unloaded ones)
   * Returns metadata for all valid modules found in the modules directory
   */
  getAllDiscoveredModules(): ModuleMetadata[] {
    return this.registry.getModuleMetadata();
  }

  /**
   * Update module dependencies in database
   */
  private async updateDependencies(moduleId: string, dependencies: string[]): Promise<void> {
    // Delete existing dependencies
    await this.prisma.moduleDependency.deleteMany({
      where: { moduleId },
    });

    // Create new dependencies
    for (const depId of dependencies) {
      await this.prisma.moduleDependency.create({
        data: {
          moduleId,
          dependsOnId: depId,
        },
      });
    }
  }

  /**
   * Shutdown all modules
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down all modules...');

    // Get modules in reverse load order (dependents first)
    const moduleIds = Array.from(this.loadedModules.keys()).reverse();

    for (const moduleId of moduleIds) {
      await this.unloadModule(moduleId, true);
    }

    logger.info('All modules shut down');
  }
}
