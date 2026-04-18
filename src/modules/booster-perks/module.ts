import { BaseModule, ModuleMetadata, ModuleContext } from '../../types/module.types.js';
import { command as boosterCommand, setService as setCommandService } from './commands/booster.js';
import { interactionCreateEvent, setService as setEventService } from './events/interactionCreate.js';
import { BoosterPerksService } from './services/BoosterPerksService.js';
import { DatabaseService } from '../../core/database/postgres.js';
import { Logger } from '../../shared/utils/logger.js';
import { getModuleSettingsService } from '../../core/settings/ModuleSettingsService.js';
import type { ModuleSettingsSchema } from '../../core/settings/SettingsDefinition.js';

const logger = new Logger('BoosterPerks');

const BOOSTER_PERKS_SETTINGS_SCHEMA: ModuleSettingsSchema = {
  moduleId: 'booster-perks',
  moduleName: 'Booster Perks',
  settings: [
    {
      key: 'max_sounds_per_user',
      name: 'Max Sounds Per Booster',
      description: 'Maximum number of custom soundboard sounds each booster can have',
      type: 'number',
      defaultValue: 5,
      min: 1,
      max: 25,
      category: 'limits',
    },
    {
      key: 'max_emojis_per_user',
      name: 'Max Emojis Per Booster',
      description: 'Maximum number of custom emojis each booster can have',
      type: 'number',
      defaultValue: 3,
      min: 1,
      max: 15,
      category: 'limits',
    },
  ],
};

export interface BoosterPerksSettings extends Record<string, unknown> {
  max_sounds_per_user: number;
  max_emojis_per_user: number;
}

/**
 * Booster Perks Module - Exclusive features for server boosters
 *
 * Features:
 * - Custom soundboard sounds (upload from URL)
 * - Custom emojis (upload from URL)
 * - Configurable per-user limits via /settings
 *
 * Emits events: (none yet)
 * Consumes events: (none yet)
 */
export class BoosterPerksModule extends BaseModule {
  readonly metadata: ModuleMetadata = {
    id: 'booster-perks',
    name: 'Booster Perks',
    description: 'Exclusive features for server boosters (custom sounds, emojis, and more)',
    version: '1.0.0',
    author: 'QuadsLab',
    isCore: false,
    isPublic: true,
    dependencies: [],
    optionalDependencies: [],
    priority: 50,
  };

  readonly migrationsPath = './migrations';

  private service: BoosterPerksService | null = null;

  constructor() {
    super();
    this.commands = [boosterCommand];
    this.events = [interactionCreateEvent];
  }

  async onLoad(context: ModuleContext): Promise<void> {
    await super.onLoad(context);

    // Register settings schema
    const settingsService = getModuleSettingsService();
    if (settingsService) {
      settingsService.registerSchema(BOOSTER_PERKS_SETTINGS_SCHEMA);
    }

    // Initialize service
    const dbService = new DatabaseService();
    this.service = new BoosterPerksService(dbService);

    // Inject service into commands and events
    setCommandService(this.service);
    setEventService(this.service);

    logger.info('Booster Perks module loaded');
  }

  async onEnable(guildId: string): Promise<void> {
    logger.info(`Booster Perks enabled for guild ${guildId}`);
  }

  async onDisable(guildId: string): Promise<void> {
    logger.info(`Booster Perks disabled for guild ${guildId}`);
  }

  async onUnload(): Promise<void> {
    const settingsService = getModuleSettingsService();
    if (settingsService) {
      settingsService.unregisterSchema(this.metadata.id);
    }

    this.service = null;

    await super.onUnload();
    logger.info('Booster Perks module unloaded');
  }
}
