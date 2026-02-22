import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
} from 'discord.js';
import { defineSlashCommand } from '../../../types/command.types.js';
import { createEmbed, COLORS, errorEmbed } from '../../../shared/utils/embed.js';
import { VoiceTrackingService } from '../services/VoiceTrackingService.js';

let voiceTrackingService: VoiceTrackingService | null = null;

export function setVoiceTrackingService(service: VoiceTrackingService): void {
  voiceTrackingService = service;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${seconds} second${seconds !== 1 ? 's' : ''}`;
  }

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  const parts: string[] = [];
  if (hours > 0) {
    parts.push(`${hours}h`);
  }
  if (minutes > 0) {
    parts.push(`${minutes}m`);
  }
  if (secs > 0 && hours === 0) {
    parts.push(`${secs}s`);
  }

  return parts.join(' ') || '0s';
}

export const command = defineSlashCommand(
  new SlashCommandBuilder()
    .setName('voicetime')
    .setDescription('Check voice channel time')
    .addUserOption((opt) =>
      opt
        .setName('user')
        .setDescription('User to check (defaults to yourself)')
        .setRequired(false)
    ) as SlashCommandBuilder,

  async (interaction: ChatInputCommandInteraction) => {
    if (!voiceTrackingService) {
      await interaction.reply({
        embeds: [errorEmbed('Error', 'Voice tracking service not available')],
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

    const stats = await voiceTrackingService.getStatsWithActiveTime(
      targetUser.id,
      guildId
    );

    const rank = await voiceTrackingService.getUserRank(targetUser.id, guildId);
    const totalUsers = await voiceTrackingService.getTotalUsers(guildId);

    const embed = createEmbed(COLORS.primary)
      .setTitle(`🎙️ ${targetUser.displayName}'s Voice Time`)
      .setThumbnail(targetUser.displayAvatarURL({ size: 128 }))
      .addFields(
        {
          name: 'Total Time',
          value: `**${formatDuration(stats.totalSeconds)}**`,
          inline: true,
        },
        {
          name: 'Sessions',
          value: `${stats.sessionCount.toLocaleString()}`,
          inline: true,
        },
        {
          name: 'Rank',
          value: totalUsers > 0 ? `#${rank} of ${totalUsers}` : 'N/A',
          inline: true,
        }
      );

    if (stats.isInVoice) {
      embed.addFields({
        name: 'Status',
        value: '🟢 Currently in voice',
        inline: false,
      });
    }

    await interaction.reply({ embeds: [embed] });
  },
  {
    guildOnly: true,
  }
);
