import { BaseModule, ModuleMetadata, ModuleContext } from '../../types/module.types.js';
import { command as ideasCommand, setIdeasService } from './commands/ideas.js';
import { threadCreateEvent } from './events/threadCreate.js';
import { messageCreateEvent } from './events/messageCreate.js';
import { messageReactionAddEvent } from './events/messageReactionAdd.js';
import { interactionCreateEvent } from './events/interactionCreate.js';
import { IdeasService, initIdeasService } from './services/IdeasService.js';
import { DatabaseService } from '../../core/database/postgres.js';
import { Logger } from '../../shared/utils/logger.js';
import { getModuleSettingsService } from '../../core/settings/ModuleSettingsService.js';
import { getCronService } from '../../core/cron/index.js';
import type { ModuleSettingsSchema } from '../../core/settings/SettingsDefinition.js';

const logger = new Logger('Ideas');

/**
 * Ideas module settings schema
 */
const IDEAS_SETTINGS_SCHEMA: ModuleSettingsSchema = {
  moduleId: 'ideas',
  moduleName: 'Ideas',
  settings: [
    {
      key: 'forum_channel_id',
      name: 'Ideas Forum Channel',
      description: 'The forum channel where users can post ideas',
      type: 'channel',
      defaultValue: null,
      category: 'general',
    },
    {
      key: 'vote_threshold',
      name: 'Vote Threshold',
      description: 'Number of upvotes needed for a suggestion to be highlighted',
      type: 'number',
      defaultValue: 5,
      min: 1,
      max: 100,
      category: 'voting',
    },
    {
      key: 'auto_track_suggestions',
      name: 'Auto-Track Suggestions',
      description: 'Automatically track replies in idea threads as suggestions',
      type: 'boolean',
      defaultValue: true,
      category: 'general',
    },
  ],
};

/**
 * Ideas Module - Collaborative idea management with AI features
 *
 * Features:
 * - Forum channel integration for idea submissions
 * - AI-powered summarization, expansion, and issue detection
 * - Community voting on suggestions
 * - Admin status management (pending → approved → implemented)
 * - Automatic thread locking on approval
 */
export class IdeasModule extends BaseModule {
  readonly metadata: ModuleMetadata = {
    id: 'ideas',
    name: 'Ideas',
    description: 'Collaborative idea management with AI-powered analysis',
    version: '1.0.0',
    author: 'QuadsLab',
    isCore: false,
    isPublic: true,
    dependencies: [],
    optionalDependencies: [],
    priority: 50,
  };

  readonly migrationsPath = 'migrations';

  private ideasService: IdeasService | null = null;

  constructor() {
    super();

    // Register commands
    this.commands = [ideasCommand];

    // Register events
    this.events = [
      threadCreateEvent,
      messageCreateEvent,
      messageReactionAddEvent,
      interactionCreateEvent,
    ];
  }

  async onLoad(context: ModuleContext): Promise<void> {
    await super.onLoad(context);

    // Register settings schema
    const settingsService = getModuleSettingsService();
    if (settingsService) {
      settingsService.registerSchema(IDEAS_SETTINGS_SCHEMA);
      logger.debug('Registered settings schema');
    }

    // Create database service
    const dbService = new DatabaseService();

    // Initialize ideas service
    this.ideasService = initIdeasService(dbService);

    // Inject service into command
    setIdeasService(this.ideasService);

    // Sync settings from the centralized settings service to our local config
    await this.syncSettingsToConfig(context);

    // Register cron job for daily token reset
    const cronService = getCronService();
    if (cronService) {
      cronService.registerJob(this.metadata.id, {
        id: 'token-reset',
        schedule: 'daily',
        description: 'Reset AI tokens for all pending ideas',
        handler: async () => {
          if (this.ideasService) {
            const count = await this.ideasService.resetAllTokens();
            logger.info(`Daily token reset: ${count} ideas reset`);
          }
        },
      });
      logger.debug('Registered daily token reset cron job');
    }

    logger.info('Ideas module loaded');
  }

  /**
   * Sync centralized settings to the ideas_config table
   */
  private async syncSettingsToConfig(context: ModuleContext): Promise<void> {
    if (!this.ideasService) return;

    const settingsService = getModuleSettingsService();
    if (!settingsService) return;

    // For each guild, sync settings
    for (const guild of context.client.guilds.cache.values()) {
      try {
        const settings = await settingsService.getSettings(this.metadata.id, guild.id);
        const forumChannelId = settings['forum_channel_id'] as string | null;
        const voteThreshold = settings['vote_threshold'] as number | undefined;
        const autoTrack = settings['auto_track_suggestions'] as boolean | undefined;

        if (forumChannelId || voteThreshold !== undefined || autoTrack !== undefined) {
          await this.ideasService.setConfig(guild.id, forumChannelId, voteThreshold, autoTrack);
        }
      } catch (error) {
        logger.debug(`Could not sync settings for guild ${guild.id}:`, error);
      }
    }
  }

  async onEnable(guildId: string): Promise<void> {
    logger.info(`Ideas module enabled for guild ${guildId}`);

    // Sync settings for this guild
    if (!this.ideasService || !this.context) return;

    const settingsService = getModuleSettingsService();
    if (!settingsService) return;

    try {
      const settings = await settingsService.getSettings(this.metadata.id, guildId);
      const forumChannelId = settings['forum_channel_id'] as string | null;
      const voteThreshold = settings['vote_threshold'] as number | undefined;
      const autoTrack = settings['auto_track_suggestions'] as boolean | undefined;

      await this.ideasService.setConfig(guildId, forumChannelId, voteThreshold, autoTrack);
    } catch (error) {
      logger.debug(`Could not sync settings for guild ${guildId}:`, error);
    }
  }

  async onDisable(guildId: string): Promise<void> {
    logger.info(`Ideas module disabled for guild ${guildId}`);
    // Ideas and config remain in database for potential re-enable
  }

  async onUnload(): Promise<void> {
    logger.info('Unloading Ideas module...');

    // Unregister cron jobs
    const cronService = getCronService();
    if (cronService) {
      cronService.unregisterAllForModule(this.metadata.id);
      logger.debug('Unregistered cron jobs');
    }

    // Unregister settings schema
    const settingsService = getModuleSettingsService();
    if (settingsService) {
      settingsService.unregisterSchema(this.metadata.id);
    }

    this.ideasService = null;

    logger.info('Ideas module unloaded');
  }
}
