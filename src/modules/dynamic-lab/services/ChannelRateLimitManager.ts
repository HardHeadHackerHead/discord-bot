import { VoiceChannel } from 'discord.js';
import { Logger } from '../../../shared/utils/logger.js';

const logger = new Logger('DynamicLab:RateLimit');

/**
 * Discord rate limit for channel name changes:
 * - 2 changes per 10 minutes per channel
 *
 * This manager tracks when name changes occur and queues
 * changes that would exceed the rate limit.
 */

/** Rate limit: 2 changes per 10 minutes (600,000 ms) */
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const MAX_CHANGES_PER_WINDOW = 2;

/** Check interval for processing queued changes */
const QUEUE_CHECK_INTERVAL_MS = 30 * 1000; // 30 seconds

/**
 * Tracks name change history for a channel
 */
interface ChannelNameHistory {
  /** Timestamps of recent name changes (within the rate limit window) */
  changeTimes: number[];
  /** Pending name change (if rate limited) */
  pendingName: string | null;
  /** Callback to execute after the name change completes */
  pendingCallback: (() => void) | null;
}

/**
 * Manages rate limits for Discord channel name changes.
 *
 * Discord limits channel name changes to 2 per 10 minutes per channel.
 * This manager:
 * - Tracks when name changes occur
 * - Queues changes that would exceed the rate limit
 * - Automatically processes queued changes when the rate limit window passes
 */
export class ChannelRateLimitManager {
  /** Map of channel ID to name change history */
  private channelHistory: Map<string, ChannelNameHistory> = new Map();

  /** Interval for processing queued changes */
  private queueProcessor: NodeJS.Timeout | null = null;

  constructor() {
    this.startQueueProcessor();
  }

  /**
   * Start the background queue processor
   */
  private startQueueProcessor(): void {
    this.queueProcessor = setInterval(() => {
      this.processQueue();
    }, QUEUE_CHECK_INTERVAL_MS);
  }

  /**
   * Stop the queue processor (call on shutdown)
   */
  destroy(): void {
    if (this.queueProcessor) {
      clearInterval(this.queueProcessor);
      this.queueProcessor = null;
    }
    this.channelHistory.clear();
  }

  /**
   * Get or create history entry for a channel
   */
  private getHistory(channelId: string): ChannelNameHistory {
    let history = this.channelHistory.get(channelId);
    if (!history) {
      history = {
        changeTimes: [],
        pendingName: null,
        pendingCallback: null,
      };
      this.channelHistory.set(channelId, history);
    }
    return history;
  }

  /**
   * Clean up old timestamps outside the rate limit window
   */
  private cleanupOldTimestamps(history: ChannelNameHistory): void {
    const cutoff = Date.now() - RATE_LIMIT_WINDOW_MS;
    history.changeTimes = history.changeTimes.filter(time => time > cutoff);
  }

  /**
   * Check if a name change can be made right now
   */
  canChangeName(channelId: string): boolean {
    const history = this.getHistory(channelId);
    this.cleanupOldTimestamps(history);
    return history.changeTimes.length < MAX_CHANGES_PER_WINDOW;
  }

  /**
   * Get the time until the next name change is allowed (in ms)
   * Returns 0 if a change can be made now
   */
  getTimeUntilNextChange(channelId: string): number {
    const history = this.getHistory(channelId);
    this.cleanupOldTimestamps(history);

    if (history.changeTimes.length < MAX_CHANGES_PER_WINDOW) {
      return 0;
    }

    // Find the oldest timestamp - that's when the window will open
    const oldestChange = Math.min(...history.changeTimes);
    const timeUntilOpen = (oldestChange + RATE_LIMIT_WINDOW_MS) - Date.now();
    return Math.max(0, timeUntilOpen);
  }

  /**
   * Record that a name change was made
   */
  recordNameChange(channelId: string): void {
    const history = this.getHistory(channelId);
    history.changeTimes.push(Date.now());
    this.cleanupOldTimestamps(history);
    logger.debug(`Recorded name change for channel ${channelId}, ${history.changeTimes.length}/${MAX_CHANGES_PER_WINDOW} in window`);
  }

  /**
   * Queue a name change for later if rate limited
   */
  queueNameChange(channelId: string, newName: string, callback?: () => void): void {
    const history = this.getHistory(channelId);
    history.pendingName = newName;
    history.pendingCallback = callback || null;

    const waitTime = this.getTimeUntilNextChange(channelId);
    logger.info(`Queued name change for channel ${channelId} to "${newName}", will process in ~${Math.ceil(waitTime / 1000)}s`);
  }

  /**
   * Check if there's a pending name change for a channel
   */
  hasPendingChange(channelId: string): boolean {
    const history = this.channelHistory.get(channelId);
    return history?.pendingName !== null;
  }

  /**
   * Get the pending name for a channel (if any)
   */
  getPendingName(channelId: string): string | null {
    const history = this.channelHistory.get(channelId);
    return history?.pendingName || null;
  }

  /**
   * Clear any pending name change for a channel
   * (e.g., if the lab is deleted before the change processes)
   */
  clearPending(channelId: string): void {
    const history = this.channelHistory.get(channelId);
    if (history) {
      history.pendingName = null;
      history.pendingCallback = null;
    }
  }

  /**
   * Remove all tracking for a channel (call when lab is deleted)
   */
  removeChannel(channelId: string): void {
    this.channelHistory.delete(channelId);
  }

  /**
   * Process queued name changes
   */
  private async processQueue(): Promise<void> {
    for (const [channelId, history] of this.channelHistory) {
      if (!history.pendingName) continue;

      this.cleanupOldTimestamps(history);

      // Check if we can make the change now
      if (history.changeTimes.length < MAX_CHANGES_PER_WINDOW) {
        const pendingName = history.pendingName;
        const callback = history.pendingCallback;

        // Clear the pending change before processing
        history.pendingName = null;
        history.pendingCallback = null;

        logger.debug(`Processing queued name change for channel ${channelId} to "${pendingName}"`);

        // Execute the callback if provided
        if (callback) {
          try {
            callback();
          } catch (error) {
            logger.error(`Error in queued name change callback for ${channelId}:`, error);
          }
        }
      }
    }
  }

  /**
   * Attempt to change a channel's name, respecting rate limits.
   *
   * @param channel The voice channel to rename
   * @param newName The new name for the channel
   * @param onQueued Optional callback when the change is queued (not immediately applied)
   * @returns Object with `changed` (true if changed immediately) and `queued` (true if queued for later)
   */
  async tryChangeName(
    channel: VoiceChannel,
    newName: string,
    onQueued?: () => void
  ): Promise<{ changed: boolean; queued: boolean }> {
    const channelId = channel.id;

    // If the name is already correct, no need to change
    if (channel.name === newName) {
      return { changed: false, queued: false };
    }

    // Check if we can change now
    if (this.canChangeName(channelId)) {
      try {
        await channel.setName(newName, 'Lab name update');
        this.recordNameChange(channelId);
        logger.debug(`Changed channel ${channelId} name to "${newName}"`);
        return { changed: true, queued: false };
      } catch (error) {
        // If we get a rate limit error, queue it
        if (error instanceof Error && error.message.includes('rate limit')) {
          logger.warn(`Rate limited on channel ${channelId}, queueing name change`);
          this.queueNameChange(channelId, newName, onQueued);
          return { changed: false, queued: true };
        }
        throw error;
      }
    } else {
      // Rate limited, queue the change
      this.queueNameChange(channelId, newName, onQueued);
      if (onQueued) onQueued();
      return { changed: false, queued: true };
    }
  }

  /**
   * Change a channel's name with rate limit awareness.
   * This is a wrapper that handles the common case where you just want
   * to change the name and have it queued if rate limited.
   *
   * @param channel The voice channel
   * @param newName The new name
   * @param updateChannel Function to actually update the channel (called when rate limit allows)
   */
  async scheduleNameChange(
    channel: VoiceChannel,
    newName: string,
    updateChannel: (channel: VoiceChannel, name: string) => Promise<void>
  ): Promise<{ immediate: boolean; queuedFor?: Date }> {
    const channelId = channel.id;

    // If name is already correct, skip
    if (channel.name === newName) {
      return { immediate: true };
    }

    if (this.canChangeName(channelId)) {
      // Can change now
      await updateChannel(channel, newName);
      this.recordNameChange(channelId);
      return { immediate: true };
    } else {
      // Need to queue - store the update function as a callback
      const timeUntil = this.getTimeUntilNextChange(channelId);
      const queuedFor = new Date(Date.now() + timeUntil);

      // Store the pending change with a callback that will re-fetch the channel
      // in case it was modified since queuing
      this.queueNameChange(channelId, newName, async () => {
        try {
          // Re-fetch the channel to make sure it still exists
          const freshChannel = await channel.guild.channels.fetch(channelId) as VoiceChannel | null;
          if (freshChannel && freshChannel.type === channel.type) {
            await updateChannel(freshChannel, newName);
            this.recordNameChange(channelId);
          }
        } catch (error) {
          logger.error(`Failed to apply queued name change for ${channelId}:`, error);
        }
      });

      logger.info(`Channel ${channelId} name change queued, will apply at ${queuedFor.toISOString()}`);
      return { immediate: false, queuedFor };
    }
  }
}

// Singleton instance
let instance: ChannelRateLimitManager | null = null;

/**
 * Get the singleton ChannelRateLimitManager instance
 */
export function getChannelRateLimitManager(): ChannelRateLimitManager {
  if (!instance) {
    instance = new ChannelRateLimitManager();
  }
  return instance;
}

/**
 * Destroy the singleton instance (call on bot shutdown)
 */
export function destroyChannelRateLimitManager(): void {
  if (instance) {
    instance.destroy();
    instance = null;
  }
}
