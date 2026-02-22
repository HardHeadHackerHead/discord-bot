import type { Client } from 'discord.js';
import type { PrismaClient } from '@prisma/client';
import type { ModuleCommand } from './command.types.js';
import type { AnyModuleEvent } from './event.types.js';
import type { DatabaseService } from '../core/database/mysql.js';
import type { ModuleEventBus } from '../core/modules/ModuleEventBus.js';

/**
 * Module metadata describing the module
 */
export interface ModuleMetadata {
  /** Unique identifier for the module (e.g., "user-tracking") */
  id: string;

  /** Display name for the module */
  name: string;

  /** Module description */
  description: string;

  /** Semantic version (e.g., "1.0.0") */
  version: string;

  /** Module author (optional) */
  author?: string;

  /** Whether this is a core module (cannot be disabled) */
  isCore: boolean;

  /** Whether users can see this module is loaded */
  isPublic: boolean;

  /** Module IDs this module depends on (required - module won't load without them) */
  dependencies: string[];

  /**
   * Optional dependencies (module loads regardless, but features may be limited)
   * If a module in this list is loaded, additional features become available.
   * Example: voice-tracking has optional dependency on 'points' - if points is loaded,
   * voice sessions award points; otherwise, they just track time.
   */
  optionalDependencies?: string[];

  /** Priority for loading order (higher = earlier, default = 50) */
  priority: number;
}

/**
 * Default metadata values
 */
export const DEFAULT_MODULE_METADATA: Partial<ModuleMetadata> = {
  author: undefined,
  isCore: false,
  isPublic: true,
  dependencies: [],
  optionalDependencies: [],
  priority: 50,
};

/**
 * Module state stored in database
 */
export interface ModuleState {
  id: string;
  enabled: boolean;
  loadedAt: Date | null;
  lastError: string | null;
  settings: Record<string, unknown>;
}

/**
 * Context passed to modules during lifecycle events
 */
export interface ModuleContext {
  /** Discord.js client */
  client: Client;

  /** Prisma client for core tables */
  prisma: PrismaClient;

  /** Database service for module's custom tables */
  db: DatabaseService;

  /** Event bus for inter-module communication */
  events: ModuleEventBus;

  /**
   * Check if an optional dependency is loaded
   * @param moduleId The module ID to check
   * @returns true if the module is loaded
   */
  isModuleLoaded(moduleId: string): boolean;
}

/**
 * Module lifecycle hooks
 */
export interface ModuleLifecycle {
  /**
   * Called when module is loaded (after migrations run)
   * Use this to initialize services, cache data, etc.
   */
  onLoad?(context: ModuleContext): Promise<void>;

  /**
   * Called when module is enabled for a guild
   * Use this to set up guild-specific resources
   */
  onEnable?(guildId: string): Promise<void>;

  /**
   * Called when module is disabled for a guild
   * Use this to clean up guild-specific resources
   */
  onDisable?(guildId: string): Promise<void>;

  /**
   * Called when module is unloaded
   * Use this to clean up resources, close connections, etc.
   */
  onUnload?(): Promise<void>;

  /**
   * Called when module is hot-reloaded (development only)
   * Use this to preserve state across reloads if needed
   */
  onReload?(): Promise<void>;
}

/**
 * Main module interface that all modules must implement
 */
export interface BotModule extends ModuleLifecycle {
  /** Module metadata */
  readonly metadata: ModuleMetadata;

  /** Commands provided by this module */
  readonly commands: ModuleCommand[];

  /** Events listened to by this module */
  readonly events: AnyModuleEvent[];

  /** Default settings for this module */
  readonly defaultSettings: Record<string, unknown>;

  /**
   * Path to migrations folder (relative to module directory)
   * Set to null if the module has no migrations
   */
  readonly migrationsPath: string | null;
}

/**
 * Abstract base class for modules.
 * Provides default implementations and common functionality.
 */
export abstract class BaseModule implements BotModule {
  abstract readonly metadata: ModuleMetadata;

  /** Module context - set during onLoad */
  protected context: ModuleContext | null = null;

  /** Shorthand access to client */
  protected get client(): Client {
    if (!this.context) {
      throw new Error('Module not loaded - context not available');
    }
    return this.context.client;
  }

  /** Shorthand access to prisma */
  protected get prisma(): PrismaClient {
    if (!this.context) {
      throw new Error('Module not loaded - context not available');
    }
    return this.context.prisma;
  }

  /** Shorthand access to database service */
  protected get db(): DatabaseService {
    if (!this.context) {
      throw new Error('Module not loaded - context not available');
    }
    return this.context.db;
  }

  /** Shorthand access to event bus */
  protected get eventBus(): ModuleEventBus {
    if (!this.context) {
      throw new Error('Module not loaded - context not available');
    }
    return this.context.events;
  }

  /**
   * Check if an optional dependency module is loaded
   * @param moduleId The module ID to check
   */
  protected isModuleLoaded(moduleId: string): boolean {
    if (!this.context) {
      throw new Error('Module not loaded - context not available');
    }
    return this.context.isModuleLoaded(moduleId);
  }

  // Default implementations
  commands: ModuleCommand[] = [];
  events: AnyModuleEvent[] = [];
  defaultSettings: Record<string, unknown> = {};
  migrationsPath: string | null = './migrations';

  /**
   * Base onLoad implementation - stores context
   */
  async onLoad(context: ModuleContext): Promise<void> {
    this.context = context;
  }

  /**
   * Base onUnload implementation - clears context
   */
  async onUnload(): Promise<void> {
    this.context = null;
  }
}

/**
 * Type guard to check if an object is a valid BotModule
 */
export function isBotModule(obj: unknown): obj is BotModule {
  if (!obj || typeof obj !== 'object') return false;

  const module = obj as Partial<BotModule>;

  return (
    typeof module.metadata === 'object' &&
    typeof module.metadata?.id === 'string' &&
    typeof module.metadata?.name === 'string' &&
    typeof module.metadata?.version === 'string' &&
    Array.isArray(module.commands) &&
    Array.isArray(module.events)
  );
}

/**
 * Re-export command and event types for convenience
 */
export type { ModuleCommand } from './command.types.js';
export type { ModuleEvent, AnyModuleEvent } from './event.types.js';
