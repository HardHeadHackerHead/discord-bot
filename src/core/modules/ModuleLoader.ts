import { join } from 'path';
import { existsSync } from 'fs';
import type { BotModule } from '../../types/module.types.js';
import { isBotModule } from '../../types/module.types.js';
import { Logger } from '../../shared/utils/logger.js';

const logger = new Logger('ModuleLoader');

/**
 * Error thrown when module loading fails
 */
export class ModuleLoadError extends Error {
  constructor(
    public readonly moduleId: string,
    public readonly cause: Error
  ) {
    super(`Failed to load module "${moduleId}": ${cause.message}`);
    this.name = 'ModuleLoadError';
  }
}

/**
 * Handles dynamic loading and hot-reloading of modules.
 */
export class ModuleLoader {
  /** Cache of loaded module paths for hot-reload */
  private moduleCache: Map<string, string> = new Map();

  /** Counter for cache-busting on reload */
  private loadCounter: Map<string, number> = new Map();

  /**
   * Load a module from the given path
   * @param moduleId Module identifier
   * @param modulePath Absolute path to module directory
   * @returns Loaded module instance
   */
  async load(moduleId: string, modulePath: string): Promise<BotModule> {
    logger.debug(`Loading module: ${moduleId} from ${modulePath}`);

    try {
      // Build path to module entry point
      const entryPath = this.buildEntryPath(modulePath);

      // Cache the path for hot-reload
      this.moduleCache.set(moduleId, entryPath);

      // Increment load counter for cache-busting
      const count = (this.loadCounter.get(moduleId) || 0) + 1;
      this.loadCounter.set(moduleId, count);

      // Import with cache-busting query parameter
      const importPath = `${entryPath}?v=${count}&t=${Date.now()}`;
      const moduleExport = await import(importPath);

      // Get the default export or the module itself
      const module = moduleExport.default || moduleExport;

      // Validate module structure
      if (!isBotModule(module)) {
        throw new Error('Module does not export a valid BotModule');
      }

      logger.info(`Module loaded: ${moduleId} v${module.metadata.version}`);
      return module;

    } catch (error) {
      const cause = error instanceof Error ? error : new Error(String(error));
      throw new ModuleLoadError(moduleId, cause);
    }
  }

  /**
   * Reload a module (hot-reload)
   * @param moduleId Module identifier
   * @param modulePath Absolute path to module directory
   * @returns Reloaded module instance
   */
  async reload(moduleId: string, modulePath: string): Promise<BotModule> {
    logger.info(`Hot-reloading module: ${moduleId}`);

    // Clear the old module from cache
    this.clearModuleCache(moduleId);

    // Load fresh instance
    return this.load(moduleId, modulePath);
  }

  /**
   * Clear module from Node's require cache
   * This is needed for hot-reload to work properly
   */
  clearModuleCache(moduleId: string): void {
    const modulePath = this.moduleCache.get(moduleId);
    if (!modulePath) return;

    logger.debug(`Clearing cache for module: ${moduleId}`);

    // For ESM, we can't directly clear the module cache
    // The cache-busting query parameter in import() handles this
    // But we can clear our internal tracking
    this.moduleCache.delete(moduleId);
  }

  /**
   * Build the entry path for a module
   */
  private buildEntryPath(modulePath: string): string {
    // Check for .js first (production), then .ts (development)
    const jsPath = join(modulePath, 'index.js');
    const tsPath = join(modulePath, 'index.ts');

    const entryFile = existsSync(jsPath) ? jsPath : tsPath;

    // Convert to file:// URL for Windows compatibility with ESM
    return `file:///${entryFile.replace(/\\/g, '/')}`;
  }

  /**
   * Check if a module is currently loaded
   */
  isLoaded(moduleId: string): boolean {
    return this.moduleCache.has(moduleId);
  }

  /**
   * Get all currently loaded module IDs
   */
  getLoadedModules(): string[] {
    return Array.from(this.moduleCache.keys());
  }
}

/**
 * Singleton instance
 */
export const moduleLoader = new ModuleLoader();
