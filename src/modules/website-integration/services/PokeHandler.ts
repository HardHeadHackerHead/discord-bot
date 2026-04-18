/**
 * Poke Handler Service
 * Manages "Poke a Scientist" interactions from the website
 *
 * When a website visitor pokes:
 * 1. Check if anyone is in voice channels
 * 2. If yes: Post to channel and @mention a random person in voice
 * 3. If no: Post to the interaction channel for first-come-first-serve (with role ping)
 * 4. When someone responds, send the response back to the website
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
  ChannelType,
} from 'discord.js';
import { Logger } from '../../../shared/utils/logger.js';
import { COLORS } from '../../../shared/utils/embed.js';
import { WebsiteApiService } from './WebsiteApiService.js';
import { POKE_RESPONSES, type PendingInteraction } from '../types/website.types.js';
import type { PointsService } from '../../points/services/PointsService.js';

const logger = new Logger('WebsiteIntegration:Poke');

// Track active poke interactions to prevent duplicate responses
const activePokes = new Map<string, {
  interactionId: string;
  messageId: string;
  channelId: string;
  targetMemberId?: string; // Member who was @mentioned (if someone was in voice)
  createdAt: Date;
}>();

// Timeout for poke interactions (3 minutes, matching website polling)
const POKE_TIMEOUT_MS = 3 * 60 * 1000;

export class PokeHandler {
  private client: Client;
  private apiService: WebsiteApiService;
  private channelId: string;
  private cleanupTimer: NodeJS.Timeout | null = null;

  // Configurable settings
  private responderRoleId: string = '';
  private pointsReward: number = 50;
  private pointsService: PointsService | null = null;

  constructor(client: Client, apiService: WebsiteApiService, channelId: string) {
    this.client = client;
    this.apiService = apiService;
    this.channelId = channelId;

    // Start cleanup timer for expired pokes
    this.startCleanupTimer();
  }

  /**
   * Update the channel ID for fallback messages
   * @deprecated Use updateSettings instead
   */
  updateChannelId(channelId: string): void {
    this.channelId = channelId;
  }

  /**
   * Update poke handler settings
   */
  updateSettings(settings: {
    channelId?: string;
    responderRoleId?: string;
    pointsReward?: number;
  }): void {
    if (settings.channelId !== undefined) {
      this.channelId = settings.channelId;
    }
    if (settings.responderRoleId !== undefined) {
      this.responderRoleId = settings.responderRoleId;
      logger.info(`Poke responder role set to: ${settings.responderRoleId || '(none)'}`);
    }
    if (settings.pointsReward !== undefined) {
      this.pointsReward = settings.pointsReward;
    }
  }

  /**
   * Set the points service for awarding points on response
   */
  setPointsService(service: PointsService): void {
    this.pointsService = service;
  }

  /**
   * Handle an incoming poke interaction
   */
  async handlePoke(interaction: PendingInteraction, guild: Guild): Promise<boolean> {
    try {
      logger.info(`Handling poke interaction ${interaction.id}`);

      // Find members in voice channels
      const membersInVoice = this.getMembersInVoice(guild);

      // Pick a random member from voice to @mention (if any)
      const targetMember = membersInVoice.length > 0
        ? membersInVoice[Math.floor(Math.random() * membersInVoice.length)]
        : undefined;

      // Always post to channel (with @mention if someone is in voice, or role ping if not)
      return await this.sendChannelPoke(interaction, guild, targetMember);
    } catch (error) {
      logger.error(`Failed to handle poke ${interaction.id}:`, error);
      return false;
    }
  }

  /**
   * Handle a response button click
   */
  async handleResponse(
    interactionId: string,
    responseId: string,
    member: GuildMember,
    message: Message
  ): Promise<boolean> {
    const pokeData = activePokes.get(interactionId);

    if (!pokeData) {
      logger.warn(`Poke ${interactionId} not found or already responded to`);
      return false;
    }

    // Find the response
    const response = POKE_RESPONSES.find(r => r.id === responseId);
    if (!response) {
      logger.error(`Unknown poke response ID: ${responseId}`);
      return false;
    }

    try {
      // Send response to website
      const result = await this.apiService.sendPokeResponse(interactionId, {
        emoji: response.emoji,
        message: response.message,
        respondedBy: member.displayName,
        avatar: member.user.displayAvatarURL({ extension: 'png', size: 128 }),
      });

      if (!result.success) {
        logger.error(`Failed to send poke response to website: ${result.error}`);
        return false;
      }

      // Award points if configured and points service available
      let pointsAwarded = 0;
      if (this.pointsService && this.pointsReward > 0 && member.guild) {
        try {
          await this.pointsService.addPoints(
            member.user.id,
            member.guild.id,
            this.pointsReward,
            'Responded to website poke',
            'other'
          );
          pointsAwarded = this.pointsReward;
          logger.info(`Awarded ${pointsAwarded} points to ${member.displayName} for poke response`);
        } catch (error) {
          logger.error('Failed to award poke points:', error);
          // Don't fail the whole response if points fail
        }
      }

      // Update the message to show who responded
      await this.updateMessageWithResponse(message, member, response, pointsAwarded);

      // Remove from active pokes
      activePokes.delete(interactionId);

      logger.info(`Poke ${interactionId} responded to by ${member.displayName} with "${response.label}"`);
      return true;
    } catch (error) {
      logger.error(`Failed to process poke response:`, error);
      return false;
    }
  }

  /**
   * Check if a poke is still active
   */
  isPokeActive(interactionId: string): boolean {
    return activePokes.has(interactionId);
  }

  /**
   * Stop the handler and clean up
   */
  stop(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    activePokes.clear();
  }

  /**
   * Get all non-bot members currently in voice channels
   */
  private getMembersInVoice(guild: Guild): GuildMember[] {
    const members: GuildMember[] = [];

    for (const channel of guild.channels.cache.values()) {
      if (channel.type === ChannelType.GuildVoice || channel.type === ChannelType.GuildStageVoice) {
        for (const member of channel.members.values()) {
          if (!member.user.bot) {
            members.push(member);
          }
        }
      }
    }

    return members;
  }

  /**
   * Send poke to the interaction channel
   * @param targetMember If provided, @mention this member (they're in voice). Otherwise ping the role.
   */
  private async sendChannelPoke(
    interaction: PendingInteraction,
    guild: Guild,
    targetMember?: GuildMember
  ): Promise<boolean> {
    if (!this.channelId) {
      logger.warn('No interaction channel configured for poke');
      return false;
    }

    const channel = guild.channels.cache.get(this.channelId) as TextChannel | undefined;
    if (!channel || !channel.isTextBased()) {
      logger.warn(`Interaction channel ${this.channelId} not found or not text-based`);
      return false;
    }

    try {
      // Build description based on whether we have a target member
      const description = targetMember
        ? `A visitor on the website wants to connect with someone in the Lab!\n\n` +
          `**${targetMember.displayName}**, you've been chosen! Pick a response to send back:`
        : `A visitor on the website wants to connect!\n\n` +
          `**First person to respond wins!** Pick a response to send back:`;

      const embed = new EmbedBuilder()
        .setColor(COLORS.primary)
        .setTitle('🧪 Someone poked the Lab!')
        .setDescription(description)
        .setThumbnail(targetMember?.user.displayAvatarURL({ size: 128 }) || guild.iconURL() || null)
        .addFields(
          {
            name: '⏱️ Time Limit',
            value: '3 minutes to respond',
            inline: true,
          },
          {
            name: '🏆 Reward',
            value: this.pointsReward > 0 ? `+${this.pointsReward} points` : 'No points configured',
            inline: true,
          }
        )
        .setFooter({ text: 'Response will be shown to the website visitor' })
        .setTimestamp();

      const buttons = this.createResponseButtons(interaction.id);

      // @mention target member if in voice, otherwise ping the responder role
      let content: string | undefined;
      if (targetMember) {
        content = `<@${targetMember.id}>`;
        logger.debug(`Sending poke to channel, mentioning ${targetMember.displayName}`);
      } else if (this.responderRoleId) {
        content = `<@&${this.responderRoleId}>`;
        logger.debug(`Sending poke to channel, pinging role ${this.responderRoleId}`);
      }

      const message = await channel.send({
        content,
        embeds: [embed],
        components: buttons,
      });

      // Track this poke
      activePokes.set(interaction.id, {
        interactionId: interaction.id,
        messageId: message.id,
        channelId: channel.id,
        targetMemberId: targetMember?.id,
        createdAt: new Date(),
      });

      logger.info(`Posted poke to channel for interaction ${interaction.id}${targetMember ? ` (mentioned ${targetMember.displayName})` : this.responderRoleId ? ' (pinged role)' : ''}`);
      return true;
    } catch (error) {
      logger.error('Failed to post poke to channel:', error);
      return false;
    }
  }

  /**
   * Create response buttons for poke interaction
   */
  private createResponseButtons(interactionId: string): ActionRowBuilder<ButtonBuilder>[] {
    const rows: ActionRowBuilder<ButtonBuilder>[] = [];
    let currentRow = new ActionRowBuilder<ButtonBuilder>();

    for (let i = 0; i < POKE_RESPONSES.length; i++) {
      const response = POKE_RESPONSES[i];
      if (!response) continue;

      const button = new ButtonBuilder()
        .setCustomId(`poke_response:${interactionId}:${response.id}`)
        .setLabel(`${response.emoji} ${response.label}`)
        .setStyle(ButtonStyle.Primary);

      currentRow.addComponents(button);

      // Max 4 buttons per row (Discord limit is 5, but 4 looks better)
      if ((i + 1) % 4 === 0 || i === POKE_RESPONSES.length - 1) {
        rows.push(currentRow);
        currentRow = new ActionRowBuilder<ButtonBuilder>();
      }
    }

    return rows;
  }

  /**
   * Update the message to show who responded and disable buttons
   */
  private async updateMessageWithResponse(
    message: Message,
    responder: GuildMember,
    response: { emoji: string; label: string; message: string },
    pointsAwarded: number = 0
  ): Promise<void> {
    const pointsText = pointsAwarded > 0 ? ` • +${pointsAwarded} pts` : '';

    const embed = new EmbedBuilder()
      .setColor(COLORS.success)
      .setDescription(`${response.emoji} **${responder.displayName}** responded: "${response.label}"${pointsText}`)
      .setFooter({ text: 'Use /website subscribe to get notified' });

    try {
      await message.edit({
        content: null,
        embeds: [embed],
        components: [],
      });
    } catch (error) {
      logger.warn('Failed to update poke message after response:', error);
    }
  }

  /**
   * Start cleanup timer to remove expired pokes
   */
  private startCleanupTimer(): void {
    // Check every 30 seconds for expired pokes
    this.cleanupTimer = setInterval(() => {
      const now = Date.now();

      for (const [interactionId, data] of activePokes) {
        if (now - data.createdAt.getTime() > POKE_TIMEOUT_MS) {
          activePokes.delete(interactionId);
          logger.debug(`Cleaned up expired poke ${interactionId}`);

          // Try to update the message to show it expired
          this.markPokeExpired(data).catch(err =>
            logger.debug('Failed to mark expired poke message:', err)
          );
        }
      }
    }, 30000);
  }

  /**
   * Mark a poke message as expired
   */
  private async markPokeExpired(data: {
    messageId: string;
    channelId: string;
  }): Promise<void> {
    try {
      const channel = await this.client.channels.fetch(data.channelId);
      if (!channel || !channel.isTextBased()) return;

      const message = await channel.messages.fetch(data.messageId);

      const embed = new EmbedBuilder()
        .setColor(COLORS.neutral)
        .setDescription('⏱️ Poke expired - no one responded in time')
        .setFooter({ text: 'Use /website subscribe to get notified' });

      await message.edit({
        content: null,
        embeds: [embed],
        components: [],
      });
    } catch {
      // Message may have been deleted or we can't edit it
    }
  }
}
