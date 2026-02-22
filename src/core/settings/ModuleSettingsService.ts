import type { PrismaClient } from '@prisma/client';
import { SettingsRegistry, settingsRegistry, ModuleSettingsSchema } from './SettingsDefinition.js';
import { Logger } from '../../shared/utils/logger.js';

const logger = new Logger('ModuleSettingsService');

/**
 * Cache entry for module settings
 */
interface CacheEntry {
  values: Record<string, unknown>;
  expiresAt: number;
}

/**
 * Service for managing module settings with schema validation.
 *
 * Usage:
 * 1. Module registers its settings schema on load
 * 2. Module uses this service to get/set settings
 * 3. Admin command can list/modify settings via this service
 */
export class ModuleSettingsService {
  private cache: Map<string, CacheEntry> = new Map();
  private cacheTTL = 5 * 60 * 1000; // 5 minutes

  constructor(
    private prisma: PrismaClient,
    private registry: SettingsRegistry = settingsRegistry
  ) {}

  /**
   * Register a module's settings schema
   */
  registerSchema(schema: ModuleSettingsSchema): void {
    this.registry.register(schema);
  }

  /**
   * Unregister a module's settings schema
   */
  unregisterSchema(moduleId: string): void {
    this.registry.unregister(moduleId);
    // Clear cache for this module
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${moduleId}:`)) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Get the settings registry
   */
  getRegistry(): SettingsRegistry {
    return this.registry;
  }

  /**
   * Build cache key
   */
  private cacheKey(moduleId: string, guildId: string): string {
    return `${moduleId}:${guildId}`;
  }

  /**
   * Get all settings for a module in a guild (with defaults applied)
   */
  async getSettings<T extends Record<string, unknown>>(
    moduleId: string,
    guildId: string
  ): Promise<T> {
    const cacheKey = this.cacheKey(moduleId, guildId);

    // Check cache
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.values as T;
    }

    // Get defaults from schema
    const defaults = this.registry.getDefaultValues(moduleId);

    // Get stored settings from database
    const guildModule = await this.prisma.guildModule.findUnique({
      where: { guildId_moduleId: { guildId, moduleId } },
    });

    // Merge defaults with stored values
    const stored = (guildModule?.settings as Record<string, unknown>) || {};
    const merged = { ...defaults, ...stored } as T;

    // Update cache
    this.cache.set(cacheKey, {
      values: merged,
      expiresAt: Date.now() + this.cacheTTL,
    });

    return merged;
  }

  /**
   * Get a single setting value
   */
  async getSetting<T>(
    moduleId: string,
    guildId: string,
    key: string
  ): Promise<T> {
    const settings = await this.getSettings(moduleId, guildId);
    return settings[key] as T;
  }

  /**
   * Set a single setting value (with validation)
   */
  async setSetting(
    moduleId: string,
    guildId: string,
    key: string,
    value: unknown
  ): Promise<{ success: boolean; error?: string }> {
    // Validate against schema
    const validation = this.registry.validateValue(moduleId, key, value);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    // Get current settings
    const current = await this.getSettings(moduleId, guildId);

    // Update the specific key
    const updated = { ...current, [key]: value };

    // Save to database
    await this.prisma.guildModule.upsert({
      where: { guildId_moduleId: { guildId, moduleId } },
      update: { settings: updated as object },
      create: { guildId, moduleId, settings: updated as object },
    });

    // Invalidate cache
    this.cache.delete(this.cacheKey(moduleId, guildId));

    logger.debug(`Set ${moduleId}.${key} = ${value} for guild ${guildId}`);

    return { success: true };
  }

  /**
   * Set multiple settings at once (with validation)
   */
  async setSettings(
    moduleId: string,
    guildId: string,
    settings: Record<string, unknown>
  ): Promise<{ success: boolean; errors?: Record<string, string> }> {
    const errors: Record<string, string> = {};

    // Validate all settings
    for (const [key, value] of Object.entries(settings)) {
      const validation = this.registry.validateValue(moduleId, key, value);
      if (!validation.valid) {
        errors[key] = validation.error!;
      }
    }

    if (Object.keys(errors).length > 0) {
      return { success: false, errors };
    }

    // Get current settings and merge
    const current = await this.getSettings(moduleId, guildId);
    const updated = { ...current, ...settings };

    // Save to database
    await this.prisma.guildModule.upsert({
      where: { guildId_moduleId: { guildId, moduleId } },
      update: { settings: updated as object },
      create: { guildId, moduleId, settings: updated as object },
    });

    // Invalidate cache
    this.cache.delete(this.cacheKey(moduleId, guildId));

    logger.debug(`Updated ${Object.keys(settings).length} settings for ${moduleId} in guild ${guildId}`);

    return { success: true };
  }

  /**
   * Reset a setting to its default value
   */
  async resetSetting(
    moduleId: string,
    guildId: string,
    key: string
  ): Promise<{ success: boolean; error?: string }> {
    const definition = this.registry.getSetting(moduleId, key);
    if (!definition) {
      return { success: false, error: `Unknown setting: ${key}` };
    }

    return this.setSetting(moduleId, guildId, key, definition.defaultValue);
  }

  /**
   * Reset all settings for a module to defaults
   */
  async resetAllSettings(moduleId: string, guildId: string): Promise<void> {
    const defaults = this.registry.getDefaultValues(moduleId);

    await this.prisma.guildModule.upsert({
      where: { guildId_moduleId: { guildId, moduleId } },
      update: { settings: defaults as object },
      create: { guildId, moduleId, settings: defaults as object },
    });

    // Invalidate cache
    this.cache.delete(this.cacheKey(moduleId, guildId));

    logger.debug(`Reset all settings for ${moduleId} in guild ${guildId}`);
  }

  /**
   * Get settings with their definitions (for display)
   */
  async getSettingsWithDefinitions(
    moduleId: string,
    guildId: string
  ): Promise<
    Array<{
      key: string;
      name: string;
      description: string;
      type: string;
      value: unknown;
      defaultValue: unknown;
      category?: string;
    }>
  > {
    const definitions = this.registry.getModuleSettings(moduleId);
    const values = await this.getSettings(moduleId, guildId);

    return definitions.map((def) => ({
      key: def.key,
      name: def.name,
      description: def.description,
      type: def.type,
      value: values[def.key],
      defaultValue: def.defaultValue,
      category: def.category,
    }));
  }

  /**
   * Clear the cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Clear cache for a specific guild
   */
  clearGuildCache(guildId: string): void {
    for (const key of this.cache.keys()) {
      if (key.endsWith(`:${guildId}`)) {
        this.cache.delete(key);
      }
    }
  }
}

/**
 * Singleton instance (initialized when prisma is available)
 */
let moduleSettingsService: ModuleSettingsService | null = null;

export function initModuleSettingsService(prisma: PrismaClient): ModuleSettingsService {
  moduleSettingsService = new ModuleSettingsService(prisma);
  return moduleSettingsService;
}

export function getModuleSettingsService(): ModuleSettingsService | null {
  return moduleSettingsService;
}
