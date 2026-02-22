import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
} from 'discord.js';
import { defineSlashCommand } from '../../../types/command.types.js';
import { createEmbed, COLORS, errorEmbed } from '../../../shared/utils/embed.js';
import { MessageTrackingService } from '../services/MessageTrackingService.js';

let messageTrackingService: MessageTrackingService | null = null;

export function setMessageTrackingService(service: MessageTrackingService): void {
  messageTrackingService = service;
}

export const command = defineSlashCommand(
  new SlashCommandBuilder()
    .setName('messages')
    .setDescription('Check message count')
    .addUserOption((opt) =>
      opt
        .setName('user')
        .setDescription('User to check (defaults to yourself)')
        .setRequired(false)
    ) as SlashCommandBuilder,

  async (interaction: ChatInputCommandInteraction) => {
    if (!messageTrackingService) {
      await interaction.reply({
        embeds: [errorEmbed('Error', 'Message tracking service not available')],
        ephemeral: true,
      });
      return;
    }

    const guildId = interaction.guildId;
    if (!guildId) {
      await interaction.reply({
        embeds: [errorEmbed('Error', 'This command can only be used in a server')],
        ephemeral: true,
      });
      return;
    }

    const targetUser = interaction.options.getUser('user') || interaction.user;

    const stats = await messageTrackingService.getStats(targetUser.id, guildId);
    const todayCount = await messageTrackingService.getTodayMessageCount(targetUser.id, guildId);
    const rank = await messageTrackingService.getUserRank(targetUser.id, guildId);
    const totalUsers = await messageTrackingService.getTotalUsers(guildId);

    const messageCount = stats?.message_count ?? 0;

    const embed = createEmbed(COLORS.primary)
      .setTitle(`💬 ${targetUser.displayName}'s Messages`)
      .setThumbnail(targetUser.displayAvatarURL({ size: 128 }))
      .addFields(
        {
          name: 'Total Messages',
          value: `**${messageCount.toLocaleString()}**`,
          inline: true,
        },
        {
          name: 'Today',
          value: `${todayCount.toLocaleString()}`,
          inline: true,
        },
        {
          name: 'Rank',
          value: totalUsers > 0 ? `#${rank} of ${totalUsers}` : 'N/A',
          inline: true,
        }
      );

    if (stats?.last_message_at) {
      const lastMessageTime = new Date(stats.last_message_at);
      embed.addFields({
        name: 'Last Message',
        value: `<t:${Math.floor(lastMessageTime.getTime() / 1000)}:R>`,
        inline: false,
      });
    }

    await interaction.reply({ embeds: [embed] });
  },
  {
    guildOnly: true,
  }
);
