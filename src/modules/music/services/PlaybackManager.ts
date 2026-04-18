import {
  joinVoiceChannel,
  VoiceConnection,
  VoiceConnectionStatus,
  entersState,
  createAudioPlayer,
  createAudioResource,
  AudioPlayer,
  AudioPlayerStatus,
  NoSubscriberBehavior,
} from '@discordjs/voice';
import type { VoiceBasedChannel, TextBasedChannel } from 'discord.js';
import { Logger } from '../../../shared/utils/logger.js';
import { StreamingClient } from './StreamingClient.js';
import type { MusicService, MusicTrackRow } from './MusicService.js';
import type { StreamTrack } from './StreamingClient.js';

const logger = new Logger('PlaybackManager');

/**
 * Entry in the playback queue
 */
export interface QueueEntry {
  track: MusicTrackRow;
  requestedBy: string;
  textChannelId: string;
}

/**
 * Per-guild playback manager. Handles voice connection, audio player, and queue.
 * Each guild has its own PlaybackManager instance stored in a Map on MusicModule.
 */
export class PlaybackManager {
  private connection: VoiceConnection | null = null;
  private player: AudioPlayer;
  private queue: QueueEntry[] = [];
  private currentEntry: QueueEntry | null = null;
  private idleTimeout: NodeJS.Timeout | null = null;
  private playStartTime: number = 0;
  private volume: number = 50;
  private idleTimeoutMs: number = 300_000; // 5 min default

  /** Callback invoked when a new track starts playing */
  onTrackStart: ((entry: QueueEntry) => void) | null = null;

  /** Callback invoked when playback ends (for listen duration tracking) */
  onTrackEnd: ((entry: QueueEntry, listenedMs: number, completed: boolean) => void) | null = null;

  /** Callback invoked when the manager disconnects */
  onDisconnect: (() => void) | null = null;

  constructor(
    public readonly guildId: string,
    private streamingClient: StreamingClient
  ) {
    this.player = createAudioPlayer({
      behaviors: {
        noSubscriber: NoSubscriberBehavior.Pause,
      },
    });

    this.player.on(AudioPlayerStatus.Idle, () => {
      this.handleTrackEnd(true);
    });

    this.player.on('error', (error) => {
      logger.error(`Audio player error in guild ${this.guildId}:`, error);
      this.handleTrackEnd(false);
    });
  }

  /**
   * Join a voice channel and subscribe the audio player
   */
  async join(channel: VoiceBasedChannel): Promise<void> {
    if (this.connection) {
      // Already connected — check if same channel
      if (this.connection.joinConfig.channelId === channel.id) return;
      this.connection.destroy();
    }

    this.connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: channel.guild.id,
      adapterCreator: channel.guild.voiceAdapterCreator,
      selfDeaf: true,
      selfMute: false,
    });

    this.connection.subscribe(this.player);

    // Wait for connection to be ready
    try {
      await entersState(this.connection, VoiceConnectionStatus.Ready, 15_000);
    } catch {
      this.connection.destroy();
      this.connection = null;
      throw new Error('Failed to join voice channel within 15 seconds');
    }

    // Handle disconnection
    this.connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        // Try to reconnect
        await Promise.race([
          entersState(this.connection!, VoiceConnectionStatus.Signalling, 5_000),
          entersState(this.connection!, VoiceConnectionStatus.Connecting, 5_000),
        ]);
      } catch {
        // Could not reconnect — destroy
        this.destroy();
      }
    });

    this.connection.on(VoiceConnectionStatus.Destroyed, () => {
      this.cleanup();
    });

    this.clearIdleTimeout();
  }

  /**
   * Add track(s) to the queue and start playback if idle
   */
  enqueue(entries: QueueEntry[]): void {
    this.queue.push(...entries);
    if (this.player.state.status === AudioPlayerStatus.Idle && !this.currentEntry) {
      this.playNext();
    }
  }

  /**
   * Get the current queue (not including the currently playing track)
   */
  getQueue(): QueueEntry[] {
    return [...this.queue];
  }

  /**
   * Get the currently playing entry
   */
  getCurrentEntry(): QueueEntry | null {
    return this.currentEntry;
  }

  /**
   * Get queue length (not including current track)
   */
  getQueueLength(): number {
    return this.queue.length;
  }

  /**
   * Get total queue size (including current track)
   */
  getTotalSize(): number {
    return this.queue.length + (this.currentEntry ? 1 : 0);
  }

  /**
   * Skip the current track
   */
  skip(): boolean {
    if (!this.currentEntry) return false;
    this.player.stop(true);
    return true;
  }

  /**
   * Stop playback, clear queue, and disconnect
   */
  stop(): void {
    this.queue = [];
    this.player.stop(true);
    this.destroy();
  }

  /**
   * Set playback volume (1-100)
   */
  setVolume(vol: number): void {
    this.volume = Math.max(1, Math.min(100, vol));
    // Volume is applied when creating the audio resource
  }

  /**
   * Set idle timeout in seconds
   */
  setIdleTimeout(seconds: number): void {
    this.idleTimeoutMs = seconds * 1000;
  }

  /**
   * Check if the manager is currently playing
   */
  isPlaying(): boolean {
    return this.player.state.status === AudioPlayerStatus.Playing;
  }

  /**
   * Check if connected to voice
   */
  isConnected(): boolean {
    return this.connection !== null && this.connection.state.status !== VoiceConnectionStatus.Destroyed;
  }

  /**
   * Get the voice channel ID the bot is connected to
   */
  getVoiceChannelId(): string | null {
    return this.connection?.joinConfig.channelId ?? null;
  }

  /**
   * Play the next track in queue
   */
  async playNext(): Promise<void> {
    this.clearIdleTimeout();

    const entry = this.queue.shift();
    if (!entry) {
      this.currentEntry = null;
      this.startIdleTimeout();
      return;
    }

    this.currentEntry = entry;

    try {
      // Get a fresh stream URL from the provider
      const streamResult = await this.streamingClient.getStreamUrl(entry.track.external_id);
      const resource = createAudioResource(streamResult.url, {
        inlineVolume: true,
      });

      if (resource.volume) {
        resource.volume.setVolume(this.volume / 100);
      }

      this.player.play(resource);
      this.playStartTime = Date.now();

      if (this.onTrackStart) {
        this.onTrackStart(entry);
      }
    } catch (error) {
      logger.error(`Failed to play track ${entry.track.title}:`, error);
      // Skip to next track
      this.currentEntry = null;
      this.playNext();
    }
  }

  /**
   * Handle track end (completed or errored)
   */
  private handleTrackEnd(completed: boolean): void {
    const entry = this.currentEntry;
    if (entry && this.onTrackEnd) {
      const listenedMs = Date.now() - this.playStartTime;
      this.onTrackEnd(entry, listenedMs, completed);
    }

    this.currentEntry = null;
    this.playNext();
  }

  /**
   * Start the idle disconnect timeout
   */
  private startIdleTimeout(): void {
    this.clearIdleTimeout();
    this.idleTimeout = setTimeout(() => {
      logger.debug(`Idle timeout reached for guild ${this.guildId}, disconnecting`);
      this.destroy();
    }, this.idleTimeoutMs);
  }

  /**
   * Clear the idle timeout
   */
  private clearIdleTimeout(): void {
    if (this.idleTimeout) {
      clearTimeout(this.idleTimeout);
      this.idleTimeout = null;
    }
  }

  /**
   * Destroy the voice connection and clean up
   */
  destroy(): void {
    if (this.connection) {
      try {
        this.connection.destroy();
      } catch {
        // Already destroyed
      }
      this.connection = null;
    }
    this.cleanup();
  }

  /**
   * Clean up internal state (called on destroy or disconnect)
   */
  private cleanup(): void {
    this.clearIdleTimeout();
    this.player.stop(true);
    this.queue = [];

    if (this.currentEntry && this.onTrackEnd) {
      const listenedMs = Date.now() - this.playStartTime;
      this.onTrackEnd(this.currentEntry, listenedMs, false);
    }
    this.currentEntry = null;

    if (this.onDisconnect) {
      this.onDisconnect();
    }
  }
}
