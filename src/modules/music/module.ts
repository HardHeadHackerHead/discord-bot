import { BaseModule, ModuleMetadata, ModuleContext } from '../../types/module.types.js';
import { command as playCommand, setPlayServices } from './commands/play.js';
import { command as musicCommand, setMusicServices } from './commands/music.js';
import {
  interactionCreateEvent,
  setInteractionServices,
} from './events/interactionCreate.js';
import {
  voiceStateUpdateEvent,
  setVoiceStateServices,
} from './events/voiceStateUpdate.js';
import { MusicService } from './services/MusicService.js';
import { StreamingClient } from './services/StreamingClient.js';
import { PlaybackManager } from './services/PlaybackManager.js';
import { Logger } from '../../shared/utils/logger.js';
import { getModuleSettingsService } from '../../core/settings/ModuleSettingsService.js';
import type { ModuleSettingsSchema } from '../../core/settings/SettingsDefinition.js';
import {
  getLeaderboardRegistry,
  LeaderboardProvider,
  LeaderboardEntry,
  UserRankInfo,
} from '../../core/leaderboards/LeaderboardRegistry.js';

const logger = new Logger('Music');

/**
 * Music module settings schema
 */
const MUSIC_SETTINGS_SCHEMA: ModuleSettingsSchema = {
  moduleId: 'music',
  moduleName: 'Music',
  settings: [
    {
      key: 'default_volume',
      name: 'Default Volume',
      description: 'Default playback volume (1-100)',
      type: 'number',
      defaultValue: 50,
      min: 1,
      max: 100,
      category: 'playback',
    },
    {
      key: 'music_channel',
      name: 'Music Channel',
      description: 'Channel for Now Playing embeds (null = command channel)',
      type: 'channel',
      defaultValue: null,
      category: 'channels',
    },
    {
      key: 'max_queue_size',
      name: 'Max Queue Size',
      description: 'Maximum number of tracks in the queue',
      type: 'number',
      defaultValue: 100,
      min: 1,
      max: 1000,
      category: 'limits',
    },
    {
      key: 'idle_timeout',
      name: 'Idle Timeout',
      description: 'Seconds to remain in voice after queue ends',
      type: 'number',
      defaultValue: 300,
      min: 30,
      max: 3600,
      category: 'playback',
    },
    {
      key: 'max_playlist_size',
      name: 'Max Playlist Size',
      description: 'Maximum tracks per playlist',
      type: 'number',
      defaultValue: 200,
      min: 1,
      max: 1000,
      category: 'limits',
    },
  ],
};

export interface MusicSettings extends Record<string, unknown> {
  default_volume: number;
  music_channel: string | null;
  max_queue_size: number;
  idle_timeout: number;
  max_playlist_size: number;
}

export class MusicModule extends BaseModule {
  readonly metadata: ModuleMetadata = {
    id: 'music',
    name: 'Music',
    description: 'Play music in voice channels with playlists, likes, and stats',
    version: '1.0.0',
    author: 'QuadsLab',
    isCore: false,
    isPublic: true,
    dependencies: [],
    optionalDependencies: [],
    priority: 50,
  };

  private musicService: MusicService | null = null;
  private streamingClient: StreamingClient | null = null;
  private managers: Map<string, PlaybackManager> = new Map();

  constructor() {
    super();
    this.commands = [playCommand, musicCommand];
    this.events = [interactionCreateEvent, voiceStateUpdateEvent];
  }

  async onLoad(context: ModuleContext): Promise<void> {
    await super.onLoad(context);

    // Register settings schema
    const settingsService = getModuleSettingsService();
    if (settingsService) {
      settingsService.registerSchema(MUSIC_SETTINGS_SCHEMA);
    }

    // Create services
    this.musicService = new MusicService(context.db, context.events);
    this.streamingClient = new StreamingClient();

    // Inject services into commands
    const getManager = (guildId: string) => this.managers.get(guildId);
    const createManager = (guildId: string) => this.createPlaybackManager(guildId);
    const removeManager = (guildId: string) => this.managers.delete(guildId);
    const getBotId = () => context.client.user?.id ?? null;

    setPlayServices(this.musicService, this.streamingClient, getManager, createManager);
    setMusicServices(this.musicService, this.streamingClient, getManager);
    setInteractionServices(this.musicService, getManager);
    setVoiceStateServices(getManager, removeManager, getBotId);

    // Register leaderboard
    this.registerLeaderboard();

    logger.info('Music module loaded');
  }

  async onUnload(): Promise<void> {
    // Destroy all playback managers
    for (const [guildId, manager] of this.managers) {
      manager.destroy();
    }
    this.managers.clear();

    // Unregister settings
    const settingsService = getModuleSettingsService();
    if (settingsService) {
      settingsService.unregisterSchema(this.metadata.id);
    }

    // Unregister leaderboard
    getLeaderboardRegistry().unregister('music-listeners');

    this.musicService = null;
    this.streamingClient = null;

    await super.onUnload();
    logger.info('Music module unloaded');
  }

  /**
   * Create a PlaybackManager for a guild with event handlers wired up
   */
  private createPlaybackManager(guildId: string): PlaybackManager {
    // Clean up existing manager if any
    const existing = this.managers.get(guildId);
    if (existing) {
      existing.destroy();
    }

    const manager = new PlaybackManager(guildId, this.streamingClient!);

    // Wire up track start/end callbacks for stats tracking
    manager.onTrackStart = (entry) => {
      if (this.musicService) {
        this.musicService.recordPlay(
          entry.track.id,
          guildId,
          entry.requestedBy,
          entry.textChannelId
        ).catch((err) => logger.error('Failed to record play:', err));
      }
    };

    manager.onTrackEnd = (entry, listenedMs, completed) => {
      if (this.musicService) {
        const listenedSeconds = Math.floor(listenedMs / 1000);
        this.musicService.updateListenDuration(
          entry.track.id,
          guildId,
          entry.requestedBy,
          listenedSeconds,
          completed
        ).catch((err) => logger.error('Failed to update listen duration:', err));
      }
    };

    manager.onDisconnect = () => {
      this.managers.delete(guildId);
    };

    this.managers.set(guildId, manager);
    return manager;
  }

  /**
   * Register the music-listeners leaderboard
   */
  private registerLeaderboard(): void {
    if (!this.musicService) return;

    const service = this.musicService;

    const provider: LeaderboardProvider = {
      async getEntries(guildId: string, limit: number, offset: number): Promise<LeaderboardEntry[]> {
        const entries = await service.getLeaderboard(guildId, limit, offset);
        return entries.map((e) => ({
          userId: e.user_id,
          value: e.total_listen_seconds,
          secondaryValue: e.total_tracks_played,
        }));
      },

      async getUserRank(userId: string, guildId: string): Promise<UserRankInfo | null> {
        const stats = await service.getOrCreateUserStats(userId, guildId);
        if (stats.total_listen_seconds === 0) return null;
        const rank = await service.getUserRank(userId, guildId);
        return {
          rank,
          value: stats.total_listen_seconds,
          secondaryValue: stats.total_tracks_played,
        };
      },

      async getTotalUsers(guildId: string): Promise<number> {
        return service.getTotalListeners(guildId);
      },
    };

    getLeaderboardRegistry().register({
      id: 'music-listeners',
      name: 'Music Listeners',
      description: 'Most active music listeners by listen time',
      emoji: '🎵',
      moduleId: this.metadata.id,
      unit: 'seconds',
      formatValue: (value: number) => {
        const hours = Math.floor(value / 3600);
        const minutes = Math.floor((value % 3600) / 60);
        if (hours > 0) {
          return `**${hours}h ${minutes}m** listened`;
        }
        return `**${minutes}m** listened`;
      },
      formatSecondaryValue: (value: number) => `${value.toLocaleString()} tracks played`,
      provider,
    });
  }

  getService(): MusicService | null {
    return this.musicService;
  }
}
