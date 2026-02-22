import { BaseModule, ModuleMetadata, ModuleContext } from '../../types/module.types.js';
import { command as voicetimeCommand, setVoiceTrackingService as setVoicetimeService } from './commands/voicetime.js';
import { voiceStateUpdateEvent, setVoiceTrackingService as setEventService } from './events/voiceStateUpdate.js';
import { VoiceTrackingService } from './services/VoiceTrackingService.js';
import { Logger } from '../../shared/utils/logger.js';
import {
  getLeaderboardRegistry,
  LeaderboardProvider,
  LeaderboardEntry,
  UserRankInfo,
} from '../../core/leaderboards/LeaderboardRegistry.js';

const logger = new Logger('VoiceTracking');

/**
 * Format seconds into a human-readable duration
 */
function formatDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  if (hours > 0) {
    return `**${hours}h ${minutes}m**`;
  }
  return `**${minutes}m**`;
}

/**
 * Voice Tracking Module - Tracks user voice channel time
 *
 * Features:
 * - Tracks when users join/leave/switch voice channels
 * - Maintains per-user stats (total time, session count)
 * - Provides /voicetime command to check stats
 * - Emits events for integration with other modules (e.g., Points)
 *
 * Events emitted:
 * - voice-tracking:session-started - When a user joins voice
 * - voice-tracking:session-ended - When a user leaves voice (includes duration)
 */
export class VoiceTrackingModule extends BaseModule {
  readonly metadata: ModuleMetadata = {
    id: 'voice-tracking',
    name: 'Voice Tracking',
    description: 'Tracks user voice channel time and provides stats',
    version: '1.0.0',
    author: 'QuadsLab',
    isCore: false,
    isPublic: true,
    dependencies: [],
    optionalDependencies: ['points'], // If points is loaded, voice time can earn points
    priority: 50,
  };

  readonly migrationsPath = './migrations';

  private voiceTrackingService: VoiceTrackingService | null = null;

  constructor() {
    super();

    this.commands = [voicetimeCommand];
    this.events = [voiceStateUpdateEvent];
  }

  async onLoad(context: ModuleContext): Promise<void> {
    await super.onLoad(context);

    // Create service
    this.voiceTrackingService = new VoiceTrackingService(context.db, context.events);

    // Inject service into commands and events
    setVoicetimeService(this.voiceTrackingService);
    setEventService(this.voiceTrackingService);

    // Clean up any stale sessions from previous runs
    await this.voiceTrackingService.cleanupStaleSessions(24);

    // Restore sessions for users currently in voice
    await this.restoreActiveSessions(context);

    // Register leaderboard with central registry
    this.registerLeaderboard();

    logger.info('Voice Tracking module loaded');
  }

  private registerLeaderboard(): void {
    if (!this.voiceTrackingService) return;

    const service = this.voiceTrackingService;
    const provider: LeaderboardProvider = {
      async getEntries(guildId: string, limit: number, offset: number): Promise<LeaderboardEntry[]> {
        const entries = await service.getLeaderboard(guildId, limit, offset);
        return entries.map((e) => ({
          userId: e.user_id,
          value: e.total_seconds,
          secondaryValue: e.session_count,
        }));
      },

      async getUserRank(userId: string, guildId: string): Promise<UserRankInfo | null> {
        const stats = await service.getStats(userId, guildId);
        if (!stats) return null;

        const rank = await service.getUserRank(userId, guildId);
        return {
          rank,
          value: stats.total_seconds,
          secondaryValue: stats.session_count,
        };
      },

      async getTotalUsers(guildId: string): Promise<number> {
        return service.getTotalUsers(guildId);
      },
    };

    getLeaderboardRegistry().register({
      id: 'voicetime',
      name: 'Voice Time',
      description: 'Total time spent in voice channels',
      emoji: '🎤',
      moduleId: this.metadata.id,
      unit: 'time',
      formatValue: (seconds: number) => formatDuration(seconds),
      formatSecondaryValue: (count: number) => `${count} session${count !== 1 ? 's' : ''}`,
      provider,
    });

    logger.debug('Registered voice time leaderboard');
  }

  /**
   * Restore sessions for users who are currently in voice channels
   * (handles bot restarts while users are in voice)
   */
  private async restoreActiveSessions(context: ModuleContext): Promise<void> {
    if (!this.voiceTrackingService) return;

    let restoredCount = 0;

    for (const guild of context.client.guilds.cache.values()) {
      for (const [, member] of guild.members.cache) {
        if (member.user.bot) continue;
        if (!member.voice.channelId) continue;

        // Check if they already have an active session
        const existing = await this.voiceTrackingService.getActiveSession(
          member.id,
          guild.id
        );

        if (!existing) {
          await this.voiceTrackingService.startSession(
            member.id,
            guild.id,
            member.voice.channelId
          );
          restoredCount++;
        }
      }
    }

    if (restoredCount > 0) {
      logger.info(`Restored ${restoredCount} voice sessions for users currently in voice`);
    }
  }

  async onUnload(): Promise<void> {
    // Unregister leaderboard
    getLeaderboardRegistry().unregister('voicetime');

    this.voiceTrackingService = null;
    await super.onUnload();
    logger.info('Voice Tracking module unloaded');
  }

  /**
   * Get the voice tracking service for external use
   */
  getService(): VoiceTrackingService | null {
    return this.voiceTrackingService;
  }
}
