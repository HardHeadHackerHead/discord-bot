import type { PrismaClient } from '@prisma/client';
import { Logger } from '../../shared/utils/logger.js';

const logger = new Logger('SettingsManager');

/**
 * Cache entry for settings
 */
interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

/**
 * Manages guild settings with caching.
 */
export class SettingsManager {
  private prisma: PrismaClient;

  /** In-memory cache for settings */
  private cache: Map<string, CacheEntry<unknown>> = new Map();

  /** Cache TTL in milliseconds (default: 5 minutes) */
  private cacheTTL: number = 5 * 60 * 1000;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  /**
   * Build cache key from guild ID and setting key
   */
  private cacheKey(guildId: string, key: string): string {
    return `${guildId}:${key}`;
  }

  /**
   * Get a setting value for a guild
   */
  async get<T>(guildId: string, key: string, defaultValue?: T): Promise<T | undefined> {
    const cacheKey = this.cacheKey(guildId, key);

    // Check cache first
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value as T;
    }

    // Fetch from database
    const setting = await this.prisma.guildSettings.findUnique({
      where: { guildId_key: { guildId, key } },
    });

    if (!setting) {
      return defaultValue;
    }

    const value = setting.value as T;

    // Update cache
    this.cache.set(cacheKey, {
      value,
      expiresAt: Date.now() + this.cacheTTL,
    });

    return value;
  }

  /**
   * Set a setting value for a guild
   */
  async set<T>(guildId: string, key: string, value: T): Promise<void> {
    await this.prisma.guildSettings.upsert({
      where: { guildId_key: { guildId, key } },
      update: { value: value as object },
      create: { guildId, key, value: value as object },
    });

    // Update cache
    const cacheKey = this.cacheKey(guildId, key);
    this.cache.set(cacheKey, {
      value,
      expiresAt: Date.now() + this.cacheTTL,
    });

    logger.debug(`Set setting ${key} for guild ${guildId}`);
  }

  /**
   * Delete a setting for a guild
   */
  async delete(guildId: string, key: string): Promise<void> {
    await this.prisma.guildSettings.deleteMany({
      where: { guildId, key },
    });

    // Remove from cache
    this.cache.delete(this.cacheKey(guildId, key));

    logger.debug(`Deleted setting ${key} for guild ${guildId}`);
  }

  /**
   * Get all settings for a guild
   */
  async getAll(guildId: string): Promise<Record<string, unknown>> {
    const settings = await this.prisma.guildSettings.findMany({
      where: { guildId },
    });

    const result: Record<string, unknown> = {};

    for (const setting of settings) {
      result[setting.key] = setting.value;

      // Update cache
      this.cache.set(this.cacheKey(guildId, setting.key), {
        value: setting.value,
        expiresAt: Date.now() + this.cacheTTL,
      });
    }

    return result;
  }

  /**
   * Delete all settings for a guild
   */
  async deleteAll(guildId: string): Promise<void> {
    await this.prisma.guildSettings.deleteMany({
      where: { guildId },
    });

    // Clear cache entries for this guild
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${guildId}:`)) {
        this.cache.delete(key);
      }
    }

    logger.debug(`Deleted all settings for guild ${guildId}`);
  }

  /**
   * Get module settings for a guild
   */
  async getModuleSettings<T extends Record<string, unknown>>(
    guildId: string,
    moduleId: string,
    defaultSettings?: T
  ): Promise<T> {
    const guildModule = await this.prisma.guildModule.findUnique({
      where: { guildId_moduleId: { guildId, moduleId } },
    });

    if (guildModule?.settings) {
      return { ...defaultSettings, ...(guildModule.settings as T) };
    }

    return defaultSettings ?? ({} as T);
  }

  /**
   * Set module settings for a guild
   */
  async setModuleSettings<T extends Record<string, unknown>>(
    guildId: string,
    moduleId: string,
    settings: T
  ): Promise<void> {
    await this.prisma.guildModule.upsert({
      where: { guildId_moduleId: { guildId, moduleId } },
      update: { settings: settings as object },
      create: { guildId, moduleId, settings: settings as object },
    });

    logger.debug(`Set module settings for ${moduleId} in guild ${guildId}`);
  }

  /**
   * Update specific module setting fields
   */
  async updateModuleSettings<T extends Record<string, unknown>>(
    guildId: string,
    moduleId: string,
    updates: Partial<T>
  ): Promise<void> {
    const current = await this.getModuleSettings<T>(guildId, moduleId);
    const merged = { ...current, ...updates };
    await this.setModuleSettings(guildId, moduleId, merged);
  }

  /**
   * Clear the settings cache
   */
  clearCache(): void {
    this.cache.clear();
    logger.debug('Settings cache cleared');
  }

  /**
   * Clear cache for a specific guild
   */
  clearGuildCache(guildId: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${guildId}:`)) {
        this.cache.delete(key);
      }
    }
    logger.debug(`Settings cache cleared for guild ${guildId}`);
  }

  /**
   * Set cache TTL
   */
  setCacheTTL(ms: number): void {
    this.cacheTTL = ms;
  }
}
