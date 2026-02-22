import { BaseModule, ModuleMetadata, ModuleContext } from '../../types/module.types.js';
import { command as pointsCommand, setPointsService as setPointsServiceForPoints } from './commands/points.js';
import { PointsService } from './services/PointsService.js';
import { Logger } from '../../shared/utils/logger.js';
import { MODULE_EVENTS, VoiceSessionEndedEvent, MessageCountedEvent } from '../../types/module-events.types.js';
import type { EventSubscription } from '../../core/modules/ModuleEventBus.js';
import { getModuleSettingsService } from '../../core/settings/ModuleSettingsService.js';
import type { ModuleSettingsSchema } from '../../core/settings/SettingsDefinition.js';
import {
  getLeaderboardRegistry,
  LeaderboardProvider,
  LeaderboardEntry,
  UserRankInfo,
} from '../../core/leaderboards/LeaderboardRegistry.js';

const logger = new Logger('Points');

/**
 * Points module settings schema
 */
const POINTS_SETTINGS_SCHEMA: ModuleSettingsSchema = {
  moduleId: 'points',
  moduleName: 'Points',
  settings: [
    {
      key: 'voice_points_per_minute',
      name: 'Voice Points per Minute',
      description: 'Points earned per minute in voice channels (requires Voice Tracking module)',
      type: 'number',
      defaultValue: 1,
      min: 0,
      max: 100,
      category: 'earning',
    },
    {
      key: 'message_points',
      name: 'Points per Message',
      description: 'Points earned per message (requires Message Tracking module)',
      type: 'number',
      defaultValue: 1,
      min: 0,
      max: 100,
      category: 'earning',
    },
  ],
};

/**
 * Points settings interface
 */
export interface PointsSettings extends Record<string, unknown> {
  voice_points_per_minute: number;
  message_points: number;
}

/**
 * Points Module - User points and currency system
 *
 * Provides:
 * - Points balance per user per guild
 * - Admin commands to give/take/set points
 * - Leaderboard with pagination
 * - Transaction history
 * - Integration with other modules via events
 *
 * Listens to events:
 * - voice-tracking:session-ended - Awards points for voice time
 * - message-tracking:message-counted - Awards points for messages
 */
export class PointsModule extends BaseModule {
  readonly metadata: ModuleMetadata = {
    id: 'points',
    name: 'Points',
    description: 'Points and currency system with leaderboards',
    version: '1.0.0',
    author: 'QuadsLab',
    isCore: false,
    isPublic: true,
    dependencies: [],
    optionalDependencies: [],
    priority: 50,
  };

  readonly migrationsPath = './migrations';

  private pointsService: PointsService | null = null;
  private eventSubscriptions: EventSubscription[] = [];

  constructor() {
    super();

    this.commands = [
      pointsCommand,
    ];

    this.events = [];
  }

  async onLoad(context: ModuleContext): Promise<void> {
    await super.onLoad(context);

    // Register settings schema with centralized service
    const settingsService = getModuleSettingsService();
    if (settingsService) {
      settingsService.registerSchema(POINTS_SETTINGS_SCHEMA);
      logger.debug('Registered settings schema');
    }

    // Create service
    this.pointsService = new PointsService(context.db, context.events);

    // Inject service into commands
    setPointsServiceForPoints(this.pointsService);

    // Register leaderboards with central registry
    this.registerLeaderboards();

    // Subscribe to voice session events if voice-tracking might be loaded
    this.subscribeToModuleEvents(context);

    logger.info('Points module loaded');
  }

  private registerLeaderboards(): void {
    if (!this.pointsService) return;

    const service = this.pointsService;

    // Balance leaderboard (current points)
    const balanceProvider: LeaderboardProvider = {
      async getEntries(guildId: string, limit: number, offset: number): Promise<LeaderboardEntry[]> {
        const entries = await service.getLeaderboard(guildId, limit, offset);
        return entries.map((e) => ({
          userId: e.user_id,
          value: e.balance,
        }));
      },

      async getUserRank(userId: string, guildId: string): Promise<UserRankInfo | null> {
        const points = await service.getPoints(userId, guildId);
        if (!points) return null;

        const rank = await service.getUserRank(userId, guildId);
        return {
          rank,
          value: points.balance,
        };
      },

      async getTotalUsers(guildId: string): Promise<number> {
        return service.getTotalUsers(guildId);
      },
    };

    getLeaderboardRegistry().register({
      id: 'points',
      name: 'Points',
      description: 'Current points balance',
      emoji: '🏆',
      moduleId: this.metadata.id,
      unit: 'points',
      formatValue: (value: number) => `**${value.toLocaleString()}** points`,
      provider: balanceProvider,
    });

    // Lifetime leaderboard (total points ever earned)
    const lifetimeProvider: LeaderboardProvider = {
      async getEntries(guildId: string, limit: number, offset: number): Promise<LeaderboardEntry[]> {
        const entries = await service.getLifetimeLeaderboard(guildId, limit, offset);
        return entries.map((e) => ({
          userId: e.user_id,
          value: e.lifetime_earned,
        }));
      },

      async getUserRank(userId: string, guildId: string): Promise<UserRankInfo | null> {
        const points = await service.getPoints(userId, guildId);
        if (!points) return null;

        const rank = await service.getUserLifetimeRank(userId, guildId);
        return {
          rank,
          value: points.lifetime_earned,
        };
      },

      async getTotalUsers(guildId: string): Promise<number> {
        return service.getTotalLifetimeUsers(guildId);
      },
    };

    getLeaderboardRegistry().register({
      id: 'points-lifetime',
      name: 'Points (Lifetime)',
      description: 'Total points ever earned',
      emoji: '⭐',
      moduleId: this.metadata.id,
      unit: 'points',
      formatValue: (value: number) => `**${value.toLocaleString()}** points`,
      provider: lifetimeProvider,
    });

    logger.debug('Registered points leaderboards (balance + lifetime)');
  }

  private subscribeToModuleEvents(context: ModuleContext): void {
    // Listen for voice session ended events
    const voiceSub = context.events.on<VoiceSessionEndedEvent>(
      MODULE_EVENTS.VOICE_SESSION_ENDED,
      this.metadata.id,
      async (payload) => {
        await this.handleVoiceSessionEnded(payload.data);
      }
    );
    this.eventSubscriptions.push(voiceSub);

    // Listen for message counted events
    const messageSub = context.events.on<MessageCountedEvent>(
      MODULE_EVENTS.MESSAGE_COUNTED,
      this.metadata.id,
      async (payload) => {
        await this.handleMessageCounted(payload.data);
      }
    );
    this.eventSubscriptions.push(messageSub);

    logger.debug('Subscribed to module events');
  }

  private async handleVoiceSessionEnded(data: VoiceSessionEndedEvent): Promise<void> {
    if (!this.pointsService) return;

    try {
      // Get settings from centralized settings service
      const settingsService = getModuleSettingsService();
      const settings = await settingsService?.getSettings<PointsSettings>(
        this.metadata.id,
        data.guildId
      ) ?? { voice_points_per_minute: 1 } as PointsSettings;

      if (settings.voice_points_per_minute <= 0) {
        return; // Voice points disabled for this guild
      }

      // Calculate points based on duration (in minutes)
      const minutes = Math.floor(data.duration / 60);
      if (minutes <= 0) return;

      const pointsToAward = minutes * settings.voice_points_per_minute;

      // Award points
      await this.pointsService.addPoints(
        data.userId,
        data.guildId,
        pointsToAward,
        `Voice time: ${minutes} minute${minutes !== 1 ? 's' : ''}`,
        'voice'
      );

      logger.debug(
        `Awarded ${pointsToAward} points to user ${data.userId} ` +
        `for ${minutes} minutes of voice time`
      );
    } catch (error) {
      logger.error('Error handling voice session ended:', error);
    }
  }

  private async handleMessageCounted(data: MessageCountedEvent): Promise<void> {
    if (!this.pointsService) return;

    try {
      // Get settings from centralized settings service
      const settingsService = getModuleSettingsService();
      const settings = await settingsService?.getSettings<PointsSettings>(
        this.metadata.id,
        data.guildId
      ) ?? { voice_points_per_minute: 1, message_points: 1 } as PointsSettings;

      if (settings.message_points <= 0) {
        return; // Message points disabled for this guild
      }

      // Award points for the message
      await this.pointsService.addPoints(
        data.userId,
        data.guildId,
        settings.message_points,
        'Message sent',
        'message'
      );

      logger.debug(
        `Awarded ${settings.message_points} points to user ${data.userId} for message`
      );
    } catch (error) {
      logger.error('Error handling message counted:', error);
    }
  }

  async onUnload(): Promise<void> {
    // Unsubscribe from all events
    for (const sub of this.eventSubscriptions) {
      sub.unsubscribe();
    }
    this.eventSubscriptions = [];

    // Unregister settings schema
    const settingsService = getModuleSettingsService();
    if (settingsService) {
      settingsService.unregisterSchema(this.metadata.id);
    }

    // Unregister leaderboards
    getLeaderboardRegistry().unregister('points');
    getLeaderboardRegistry().unregister('points-lifetime');

    this.pointsService = null;
    await super.onUnload();

    logger.info('Points module unloaded');
  }

  /**
   * Get the points service for external use
   */
  getService(): PointsService | null {
    return this.pointsService;
  }
}
