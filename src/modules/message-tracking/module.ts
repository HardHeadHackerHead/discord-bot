import { BaseModule, ModuleMetadata, ModuleContext } from '../../types/module.types.js';
import { command as messagesCommand, setMessageTrackingService as setCommandService } from './commands/messages.js';
import { messageCreateEvent, setMessageTrackingService as setEventService } from './events/messageCreate.js';
import { MessageTrackingService } from './services/MessageTrackingService.js';
import { Logger } from '../../shared/utils/logger.js';
import { getModuleSettingsService } from '../../core/settings/ModuleSettingsService.js';
import type { ModuleSettingsSchema } from '../../core/settings/SettingsDefinition.js';
import {
  getLeaderboardRegistry,
  LeaderboardProvider,
  LeaderboardEntry,
  UserRankInfo,
} from '../../core/leaderboards/LeaderboardRegistry.js';

const logger = new Logger('MessageTracking');

/**
 * Message tracking settings schema
 */
const MESSAGE_TRACKING_SETTINGS_SCHEMA: ModuleSettingsSchema = {
  moduleId: 'message-tracking',
  moduleName: 'Message Tracking',
  settings: [
    {
      key: 'message_cooldown_seconds',
      name: 'Message Cooldown (seconds)',
      description: 'Minimum time between counted messages (anti-spam)',
      type: 'number',
      defaultValue: 60,
      min: 0,
      max: 3600,
      category: 'general',
    },
  ],
};

/**
 * Message tracking settings interface
 */
export interface MessageTrackingSettings extends Record<string, unknown> {
  message_cooldown_seconds: number;
}

/**
 * Message Tracking Module - Tracks user message counts
 *
 * Features:
 * - Tracks message count per user per guild
 * - Cooldown to prevent spam counting
 * - Daily message snapshots
 * - Leaderboard integration
 * - Emits events for integration with other modules (e.g., Points)
 *
 * Events emitted:
 * - message-tracking:message-counted - When a message is counted (not on cooldown)
 */
export class MessageTrackingModule extends BaseModule {
  readonly metadata: ModuleMetadata = {
    id: 'message-tracking',
    name: 'Message Tracking',
    description: 'Tracks user message counts and provides stats',
    version: '1.0.0',
    author: 'QuadsLab',
    isCore: false,
    isPublic: true,
    dependencies: [],
    optionalDependencies: ['points'], // If points is loaded, messages can earn points
    priority: 50,
  };

  readonly migrationsPath = './migrations';

  private messageTrackingService: MessageTrackingService | null = null;

  constructor() {
    super();

    this.commands = [messagesCommand];
    this.events = [messageCreateEvent];
  }

  async onLoad(context: ModuleContext): Promise<void> {
    await super.onLoad(context);

    // Register settings schema with centralized service
    const settingsService = getModuleSettingsService();
    if (settingsService) {
      settingsService.registerSchema(MESSAGE_TRACKING_SETTINGS_SCHEMA);
      logger.debug('Registered settings schema');
    }

    // Create service
    this.messageTrackingService = new MessageTrackingService(context.db, context.events);

    // Inject service into commands and events
    setCommandService(this.messageTrackingService);
    setEventService(this.messageTrackingService);

    // Register leaderboard with central registry
    this.registerLeaderboard();

    logger.info('Message Tracking module loaded');
  }

  private registerLeaderboard(): void {
    if (!this.messageTrackingService) return;

    const service = this.messageTrackingService;
    const provider: LeaderboardProvider = {
      async getEntries(guildId: string, limit: number, offset: number): Promise<LeaderboardEntry[]> {
        const entries = await service.getLeaderboard(guildId, limit, offset);
        return entries.map((e) => ({
          userId: e.user_id,
          value: e.message_count,
        }));
      },

      async getUserRank(userId: string, guildId: string): Promise<UserRankInfo | null> {
        const stats = await service.getStats(userId, guildId);
        if (!stats) return null;

        const rank = await service.getUserRank(userId, guildId);
        return {
          rank,
          value: stats.message_count,
        };
      },

      async getTotalUsers(guildId: string): Promise<number> {
        return service.getTotalUsers(guildId);
      },
    };

    getLeaderboardRegistry().register({
      id: 'messages',
      name: 'Messages',
      description: 'Total messages sent',
      emoji: '💬',
      moduleId: this.metadata.id,
      unit: 'messages',
      formatValue: (value: number) => `**${value.toLocaleString()}** messages`,
      provider,
    });

    logger.debug('Registered messages leaderboard');
  }

  async onUnload(): Promise<void> {
    // Unregister settings schema
    const settingsService = getModuleSettingsService();
    if (settingsService) {
      settingsService.unregisterSchema(this.metadata.id);
    }

    // Unregister leaderboard
    getLeaderboardRegistry().unregister('messages');

    this.messageTrackingService = null;
    await super.onUnload();
    logger.info('Message Tracking module unloaded');
  }

  /**
   * Get the message tracking service for external use
   */
  getService(): MessageTrackingService | null {
    return this.messageTrackingService;
  }
}
