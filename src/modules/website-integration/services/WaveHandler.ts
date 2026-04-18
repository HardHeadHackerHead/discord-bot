/**
 * Wave Handler Service
 * Manages "Wave Back" interactions from the website
 *
 * Unlike pokes (single response), waves allow multiple users to wave back.
 * Each wave back is sent to the website in real-time.
 */

import {
  Client,
  Guild,
  GuildMember,
  TextChannel,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Message,
  EmbedBuilder,
} from 'discord.js';
import { Logger } from '../../../shared/utils/logger.js';
import { COLORS } from '../../../shared/utils/embed.js';
import { WebsiteApiService } from './WebsiteApiService.js';
import type { PendingInteraction } from '../types/website.types.js';

const logger = new Logger('WebsiteIntegration:Wave');

// Track active wave interactions
const activeWaves = new Map<string, {
  interactionId: string;
  messageId: string;
  channelId: string;
  waveCount: number;
  wavers: Set<string>; // User IDs who have waved
  createdAt: Date;
}>();

// Timeout for wave interactions (5 minutes - longer than pokes since multiple responses)
const WAVE_TIMEOUT_MS = 5 * 60 * 1000;

export class WaveHandler {
  private client: Client;
  private apiService: WebsiteApiService;
  private channelId: string;
  private cleanupTimer: NodeJS.Timeout | null = null;

  // Configurable settings
  private responderRoleId: string = '';

  constructor(client: Client, apiService: WebsiteApiService, channelId: string) {
    this.client = client;
    this.apiService = apiService;
    this.channelId = channelId;

    // Start cleanup timer for expired waves
    this.startCleanupTimer();
  }

  /**
   * Update wave handler settings
   */
  updateSettings(settings: {
    channelId?: string;
    responderRoleId?: string;
  }): void {
    if (settings.channelId !== undefined) {
      this.channelId = settings.channelId;
    }
    if (settings.responderRoleId !== undefined) {
      this.responderRoleId = settings.responderRoleId;
    }
  }

  /**
   * Handle an incoming wave interaction from the website
   */
  async handleWave(interaction: PendingInteraction, guild: Guild): Promise<boolean> {
    try {
      logger.info(`Handling wave interaction ${interaction.id}`);

      if (!this.channelId) {
        logger.warn('No interaction channel configured for wave');
        return false;
      }

      const channel = guild.channels.cache.get(this.channelId) as TextChannel | undefined;
      if (!channel || !channel.isTextBased()) {
        logger.warn(`Interaction channel ${this.channelId} not found or not text-based`);
        return false;
      }

      const embed = new EmbedBuilder()
        .setColor(COLORS.primary)
        .setTitle('👋 A visitor is waving!')
        .setDescription(
          "Someone on the website just sent a friendly wave to the Lab!\n\n" +
          "**Click the button below to wave back!**\n" +
          "Multiple people can wave - let's show them some community love!"
        )
        .setThumbnail(guild.iconURL() || null)
        .addFields(
          {
            name: '⏱️ Time Limit',
            value: '5 minutes',
            inline: true,
          },
          {
            name: '👋 Waves So Far',
            value: '0',
            inline: true,
          }
        )
        .setFooter({ text: 'Each wave back is shown to the visitor in real-time!' })
        .setTimestamp();

      const button = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`wave_back:${interaction.id}`)
          .setLabel('Wave Back 👋')
          .setStyle(ButtonStyle.Primary)
      );

      // Ping the responder role if configured
      const content = this.responderRoleId ? `<@&${this.responderRoleId}>` : undefined;

      const message = await channel.send({
        content,
        embeds: [embed],
        components: [button],
      });

      // Track this wave
      activeWaves.set(interaction.id, {
        interactionId: interaction.id,
        messageId: message.id,
        channelId: channel.id,
        waveCount: 0,
        wavers: new Set(),
        createdAt: new Date(),
      });

      logger.info(`Posted wave interaction ${interaction.id} to channel${this.responderRoleId ? ' (pinged role)' : ''}`);
      return true;
    } catch (error) {
      logger.error(`Failed to handle wave ${interaction.id}:`, error);
      return false;
    }
  }

  /**
   * Handle a wave back button click
   */
  async handleWaveBack(
    interactionId: string,
    member: GuildMember,
    message: Message
  ): Promise<{ success: boolean; alreadyWaved: boolean }> {
    const waveData = activeWaves.get(interactionId);

    if (!waveData) {
      logger.warn(`Wave ${interactionId} not found or expired`);
      return { success: false, alreadyWaved: false };
    }

    // Check if user already waved
    if (waveData.wavers.has(member.id)) {
      logger.debug(`User ${member.displayName} already waved back to ${interactionId}`);
      return { success: false, alreadyWaved: true };
    }

    try {
      // Send wave back to website
      const result = await this.apiService.sendWaveBack(interactionId, {
        respondedBy: member.displayName,
        avatar: member.user.displayAvatarURL({ extension: 'png', size: 128 }),
      });

      if (!result.success) {
        logger.error(`Failed to send wave back to website: ${result.error}`);
        return { success: false, alreadyWaved: false };
      }

      // Update tracking
      waveData.wavers.add(member.id);
      waveData.waveCount++;

      // Update the message to show new wave count
      await this.updateMessageWithWaveCount(message, waveData.waveCount, member);

      logger.info(`${member.displayName} waved back to interaction ${interactionId} (total: ${waveData.waveCount})`);
      return { success: true, alreadyWaved: false };
    } catch (error) {
      logger.error('Failed to process wave back:', error);
      return { success: false, alreadyWaved: false };
    }
  }

  /**
   * Check if a wave is still active
   */
  isWaveActive(interactionId: string): boolean {
    return activeWaves.has(interactionId);
  }

  /**
   * Stop the handler and clean up
   */
  stop(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    activeWaves.clear();
  }

  /**
   * Update the message to show new wave count
   */
  private async updateMessageWithWaveCount(
    message: Message,
    waveCount: number,
    latestWaver: GuildMember
  ): Promise<void> {
    try {
      const existingEmbed = message.embeds[0];
      if (!existingEmbed) return;

      const embed = EmbedBuilder.from(existingEmbed)
        .setFields(
          {
            name: '⏱️ Time Limit',
            value: '5 minutes',
            inline: true,
          },
          {
            name: '👋 Waves So Far',
            value: waveCount.toString(),
            inline: true,
          },
          {
            name: '🎉 Latest Wave',
            value: latestWaver.displayName,
            inline: true,
          }
        );

      await message.edit({
        embeds: [embed],
        components: message.components, // Keep the button
      });
    } catch (error) {
      logger.warn('Failed to update wave message:', error);
    }
  }

  /**
   * Start cleanup timer to remove expired waves
   */
  private startCleanupTimer(): void {
    // Check every 30 seconds for expired waves
    this.cleanupTimer = setInterval(() => {
      const now = Date.now();

      for (const [interactionId, data] of activeWaves) {
        if (now - data.createdAt.getTime() > WAVE_TIMEOUT_MS) {
          activeWaves.delete(interactionId);
          logger.debug(`Cleaned up expired wave ${interactionId} (had ${data.waveCount} waves)`);

          // Update the message to show it ended
          this.markWaveEnded(data).catch(err =>
            logger.debug('Failed to mark ended wave message:', err)
          );
        }
      }
    }, 30000);
  }

  /**
   * Mark a wave message as ended
   */
  private async markWaveEnded(data: {
    messageId: string;
    channelId: string;
    waveCount: number;
  }): Promise<void> {
    try {
      const channel = await this.client.channels.fetch(data.channelId);
      if (!channel || !channel.isTextBased()) return;

      const message = await channel.messages.fetch(data.messageId);

      const description = data.waveCount > 0
        ? `👋 Wave ended - **${data.waveCount}** member${data.waveCount === 1 ? '' : 's'} waved back!`
        : '⏱️ Wave expired - no one waved back';

      const embed = new EmbedBuilder()
        .setColor(data.waveCount > 0 ? COLORS.success : COLORS.neutral)
        .setDescription(description)
        .setFooter({ text: 'Use /website subscribe to get notified' });

      await message.edit({
        content: null,
        embeds: [embed],
        components: [],
      });
    } catch {
      // Message may have been deleted
    }
  }
}
