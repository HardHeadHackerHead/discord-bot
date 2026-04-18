/**
 * Interaction Poller Service
 * Polls the website for pending interactions and posts them to Discord
 */

import { Client, Guild, TextChannel } from 'discord.js';
import { Logger } from '../../../shared/utils/logger.js';
import { WebsiteApiService } from './WebsiteApiService.js';
import { PokeHandler } from './PokeHandler.js';
import { WaveHandler } from './WaveHandler.js';
import type { InteractionType, PendingInteraction } from '../types/website.types.js';

const logger = new Logger('WebsiteIntegration:Interactions');

interface InteractionPollerConfig {
  pollInterval: number; // milliseconds
}

const DEFAULT_CONFIG: InteractionPollerConfig = {
  pollInterval: 10000, // 10 seconds
};

// Random messages for each interaction type (poke and wave are handled separately)
const INTERACTION_MESSAGES: Record<Exclude<InteractionType, 'poke' | 'wave'>, string | string[]> = {
  lab_bell: '🔔 **DING DING!** Someone rang the Lab Bell from the website! A visitor is checking out the lab!',
  spin_wheel: [
    '🎰 Someone spun the Wheel of Science! Result: **"Automation is the future!"**',
    '🎰 Someone spun the Wheel of Science! Result: **"Build once, run forever!"**',
    '🎰 Someone spun the Wheel of Science! Result: **"The best code is no code!"**',
    '🎰 Someone spun the Wheel of Science! Result: **"Test in production... carefully!"**',
    '🎰 Someone spun the Wheel of Science! Result: **"Documentation is love letters to your future self!"**',
    '🎰 Someone spun the Wheel of Science! Result: **"Sleep is for the weak (and the smart)!"**',
    '🎰 Someone spun the Wheel of Science! Result: **"Coffee is just debugging fuel!"**',
    '🎰 Someone spun the Wheel of Science! Result: **"There are only 2 hard problems: cache invalidation, naming things, and off-by-one errors!"**',
  ],
};

export class InteractionPoller {
  private timer: NodeJS.Timeout | null = null;
  private recoveryTimer: NodeJS.Timeout | null = null;
  private config: InteractionPollerConfig;
  private secret: string;
  private channelId: string;
  private client: Client;
  private guild: Guild | null = null;
  private apiService: WebsiteApiService;
  private pokeHandler: PokeHandler;
  private waveHandler: WaveHandler;
  private isRunning = false;
  private isPaused = false; // Paused due to errors
  private recoveryAttempts = 0;
  private readonly BASE_RECOVERY_DELAY = 5 * 60 * 1000; // 5 minutes
  private readonly MAX_RECOVERY_DELAY = 30 * 60 * 1000; // 30 minutes

  constructor(
    apiService: WebsiteApiService,
    client: Client,
    channelId: string,
    secret: string,
    config?: Partial<InteractionPollerConfig>
  ) {
    this.apiService = apiService;
    this.client = client;
    this.channelId = channelId;
    this.secret = secret;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.pokeHandler = new PokeHandler(client, apiService, channelId);
    this.waveHandler = new WaveHandler(client, apiService, channelId);
  }

  /**
   * Set the guild for poke handling (needed to find voice channel members)
   */
  setGuild(guild: Guild): void {
    this.guild = guild;
  }

  /**
   * Get the poke handler for external button handling
   */
  getPokeHandler(): PokeHandler {
    return this.pokeHandler;
  }

  /**
   * Get the wave handler for external button handling
   */
  getWaveHandler(): WaveHandler {
    return this.waveHandler;
  }

  /**
   * Update configuration
   */
  updateConfig(channelId: string, secret: string, pollInterval?: number): void {
    this.channelId = channelId;
    this.secret = secret;
    this.pokeHandler.updateChannelId(channelId);
    this.waveHandler.updateSettings({ channelId });
    if (pollInterval !== undefined) {
      this.config.pollInterval = pollInterval * 1000; // Convert seconds to ms

      // Restart timer if running
      if (this.isRunning) {
        this.stop();
        this.start();
      }
    }
  }

  /**
   * Start polling
   */
  start(): void {
    if (this.isRunning) return;

    if (!this.channelId) {
      logger.warn('Interaction poller not started: no channel ID configured');
      return;
    }

    this.isRunning = true;
    this.schedulePoll();
    logger.info(`Interaction poller started (interval: ${this.config.pollInterval / 1000}s, channel: ${this.channelId})`);
  }

  /**
   * Stop polling
   */
  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.recoveryTimer) {
      clearTimeout(this.recoveryTimer);
      this.recoveryTimer = null;
    }
    this.pokeHandler.stop();
    this.waveHandler.stop();
    this.isRunning = false;
    this.isPaused = false;
    this.recoveryAttempts = 0;
    logger.info('Interaction poller stopped');
  }

  /**
   * Check if running
   */
  isPolling(): boolean {
    return this.isRunning;
  }

  /**
   * Poll once (for manual trigger)
   */
  async pollOnce(): Promise<number> {
    return this.poll();
  }

  /**
   * Schedule the next poll
   */
  private schedulePoll(): void {
    if (!this.isRunning) return;

    this.timer = setTimeout(async () => {
      await this.poll();
      this.schedulePoll();
    }, this.config.pollInterval);
  }

  /**
   * Poll for pending interactions
   */
  private async poll(): Promise<number> {
    try {
      const response = await this.apiService.getPendingInteractions();

      if (!response.success || !response.interactions?.length) {
        return 0;
      }

      const channel = this.client.channels.cache.get(this.channelId) as TextChannel | undefined;

      if (!channel || !channel.isTextBased()) {
        logger.warn(`Interaction channel ${this.channelId} not found or not text-based`);
        return 0;
      }

      const processedIds: string[] = [];
      const pokeInteractions: PendingInteraction[] = [];
      const waveInteractions: PendingInteraction[] = [];

      for (const interaction of response.interactions) {
        // Handle poke interactions separately - they need two-way response
        if (interaction.type === 'poke') {
          logger.info(`🧪 Poke interaction received! ID: ${interaction.id}`);
          pokeInteractions.push(interaction);
          continue;
        }

        // Handle wave interactions separately - they allow multiple responses
        if (interaction.type === 'wave') {
          logger.info(`👋 Wave interaction received! ID: ${interaction.id}`);
          waveInteractions.push(interaction);
          continue;
        }

        try {
          const message = this.getInteractionMessage(interaction);
          await channel.send(message);
          processedIds.push(interaction.id);
          logger.debug(`Posted ${interaction.type} interaction to channel`);
        } catch (error) {
          logger.error(`Failed to post interaction ${interaction.id}:`, error);
        }
      }

      // Handle poke interactions (don't mark as processed until responded)
      if (pokeInteractions.length > 0 && this.guild) {
        for (const poke of pokeInteractions) {
          const handled = await this.pokeHandler.handlePoke(poke, this.guild);
          if (handled) {
            // Poke is now active, waiting for response - mark as processed so website stops sending it
            processedIds.push(poke.id);
          }
        }
      } else if (pokeInteractions.length > 0) {
        logger.warn('Received poke interactions but no guild set');
      }

      // Handle wave interactions
      if (waveInteractions.length > 0 && this.guild) {
        for (const wave of waveInteractions) {
          const handled = await this.waveHandler.handleWave(wave, this.guild);
          if (handled) {
            // Wave is now active - mark as processed so website stops sending it
            processedIds.push(wave.id);
          }
        }
      } else if (waveInteractions.length > 0) {
        logger.warn('Received wave interactions but no guild set');
      }

      // Mark as processed (secret sent via Authorization header)
      if (processedIds.length > 0) {
        await this.apiService.markInteractionsProcessed({
          processed: processedIds,
        });
        logger.info(`Processed ${processedIds.length} website interaction(s)`);
      }

      return processedIds.length;
    } catch (error) {
      logger.error('Failed to poll for interactions:', error);
      this.isPaused = true;
      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = null;
      }
      this.isRunning = false;
      this.scheduleRecovery();
      return 0;
    }
  }

  /**
   * Schedule a recovery attempt with exponential backoff
   */
  private scheduleRecovery(): void {
    // Calculate delay with exponential backoff: 5min, 10min, 15min, 20min, 25min, 30min (max)
    const delay = Math.min(
      this.BASE_RECOVERY_DELAY * (this.recoveryAttempts + 1),
      this.MAX_RECOVERY_DELAY
    );
    this.recoveryAttempts++;

    const delayMinutes = Math.round(delay / 60000);
    logger.warn(`Interaction poller paused. Scheduling recovery attempt #${this.recoveryAttempts} in ${delayMinutes} minutes...`);

    this.recoveryTimer = setTimeout(() => {
      this.attemptRecovery();
    }, delay);
  }

  /**
   * Attempt to recover from paused state
   */
  private async attemptRecovery(): Promise<void> {
    logger.info(`Interaction poller attempting recovery (attempt #${this.recoveryAttempts})...`);

    // Reset state and try polling
    this.isPaused = false;
    this.isRunning = true;

    try {
      await this.poll();

      // If we're still running (didn't fail again), we've recovered
      if (this.isRunning && !this.isPaused) {
        logger.info('Interaction poller recovered successfully!');
        this.recoveryAttempts = 0;
        this.schedulePoll();
      }
    } catch {
      // poll() handles its own errors, but just in case
      if (!this.isPaused) {
        this.isPaused = true;
        this.isRunning = false;
        this.scheduleRecovery();
      }
    }
  }

  /**
   * Check if paused due to errors
   */
  isPausedDueToError(): boolean {
    return this.isPaused;
  }

  /**
   * Get the message for an interaction type (excludes poke and wave which are handled separately)
   */
  private getInteractionMessage(interaction: PendingInteraction): string {
    // Poke is handled separately by PokeHandler
    if (interaction.type === 'poke') {
      return `🧪 Someone poked the lab from the website!`;
    }

    // Wave is handled separately by WaveHandler
    if (interaction.type === 'wave') {
      return `👋 Someone waved from the website!`;
    }

    const messageOrMessages = INTERACTION_MESSAGES[interaction.type as Exclude<InteractionType, 'poke' | 'wave'>];

    if (!messageOrMessages) {
      return `🌐 A visitor from the website triggered an interaction: **${interaction.type}**`;
    }

    if (Array.isArray(messageOrMessages)) {
      const randomMessage = messageOrMessages[Math.floor(Math.random() * messageOrMessages.length)];
      return randomMessage ?? messageOrMessages[0] ?? `🌐 A visitor triggered: **${interaction.type}**`;
    }

    return messageOrMessages;
  }
}
