import { readdir, stat } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { ModuleMetadata, BotModule } from '../../types/module.types.js';
import { isBotModule } from '../../types/module.types.js';
import { Logger } from '../../shared/utils/logger.js';

const logger = new Logger('ModuleRegistry');

/**
 * Discovered module information
 */
export interface DiscoveredModule {
  /** Module ID (folder name) */
  id: string;

  /** Absolute path to module directory */
  path: string;

  /** Module metadata (if loaded) */
  metadata?: ModuleMetadata;

  /** Whether the module was successfully validated */
  valid: boolean;

  /** Error message if validation failed */
  error?: string;
}

/**
 * Registry for discovering and tracking available modules.
 * Scans the modules directory and validates module structure.
 */
export class ModuleRegistry {
  private modulesPath: string;
  private discoveredModules: Map<string, DiscoveredModule> = new Map();

  constructor(modulesPath?: string) {
    // Default to src/modules relative to this file
    if (modulesPath) {
      this.modulesPath = modulesPath;
    } else {
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = dirname(__filename);
      this.modulesPath = join(__dirname, '../../modules');
    }
  }

  /**
   * Discover all modules in the modules directory
   */
  async discoverModules(): Promise<DiscoveredModule[]> {
    logger.info(`Discovering modules in: ${this.modulesPath}`);
    this.discoveredModules.clear();

    try {
      const entries = await readdir(this.modulesPath, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const moduleId = entry.name;
        const modulePath = join(this.modulesPath, moduleId);

        const discovered = await this.validateModule(moduleId, modulePath);
        this.discoveredModules.set(moduleId, discovered);

        if (discovered.valid) {
          logger.debug(`Discovered module: ${moduleId}`);
        } else {
          logger.warn(`Invalid module ${moduleId}: ${discovered.error}`);
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        logger.warn(`Modules directory not found: ${this.modulesPath}`);
        return [];
      }
      throw error;
    }

    const validModules = Array.from(this.discoveredModules.values()).filter(m => m.valid);
    logger.info(`Discovered ${validModules.length} valid module(s)`);

    return Array.from(this.discoveredModules.values());
  }

  /**
   * Validate a module's structure
   */
  private async validateModule(
    moduleId: string,
    modulePath: string
  ): Promise<DiscoveredModule> {
    const discovered: DiscoveredModule = {
      id: moduleId,
      path: modulePath,
      valid: false,
    };

    try {
      // Check for index.ts or index.js
      const indexPath = await this.findModuleEntry(modulePath);
      if (!indexPath) {
        discovered.error = 'Missing index.ts or index.js';
        return discovered;
      }

      // Try to import and validate module
      const moduleExport = await import(indexPath);
      const module = moduleExport.default || moduleExport;

      if (!isBotModule(module)) {
        discovered.error = 'Module does not export a valid BotModule';
        return discovered;
      }

      // Validate metadata
      const metadata = module.metadata;
      if (metadata.id !== moduleId) {
        discovered.error = `Module ID mismatch: metadata.id="${metadata.id}" but folder="${moduleId}"`;
        return discovered;
      }

      discovered.metadata = metadata;
      discovered.valid = true;

    } catch (error) {
      discovered.error = error instanceof Error ? error.message : String(error);
    }

    return discovered;
  }

  /**
   * Find the module entry point (index.ts or index.js)
   */
  private async findModuleEntry(modulePath: string): Promise<string | null> {
    const extensions = ['.ts', '.js'];

    for (const ext of extensions) {
      const indexPath = join(modulePath, `index${ext}`);
      try {
        await stat(indexPath);
        // Convert to file:// URL for Windows compatibility
        return `file:///${indexPath.replace(/\\/g, '/')}`;
      } catch {
        // File doesn't exist, try next extension
      }
    }

    return null;
  }

  /**
   * Get a discovered module by ID
   */
  getModule(moduleId: string): DiscoveredModule | undefined {
    return this.discoveredModules.get(moduleId);
  }

  /**
   * Get all discovered modules
   */
  getAllModules(): DiscoveredModule[] {
    return Array.from(this.discoveredModules.values());
  }

  /**
   * Get all valid modules
   */
  getValidModules(): DiscoveredModule[] {
    return this.getAllModules().filter(m => m.valid);
  }

  /**
   * Get metadata for all valid modules
   */
  getModuleMetadata(): ModuleMetadata[] {
    return this.getValidModules()
      .map(m => m.metadata!)
      .filter(Boolean);
  }

  /**
   * Check if a module exists and is valid
   */
  hasModule(moduleId: string): boolean {
    const module = this.discoveredModules.get(moduleId);
    return module?.valid === true;
  }

  /**
   * Get the path to a module's directory
   */
  getModulePath(moduleId: string): string | null {
    return this.discoveredModules.get(moduleId)?.path || null;
  }

  /**
   * Get the modules directory path
   */
  getModulesPath(): string {
    return this.modulesPath;
  }
}

/**
 * Singleton instance
 */
export const moduleRegistry = new ModuleRegistry();
