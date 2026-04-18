/**
 * Inactive Users Command
 * Admin command to view members with no activity
 */

import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
} from 'discord.js';
import { SlashCommand } from '../../../types/command.types.js';
import { InactiveUsersService } from '../services/InactiveUsersService.js';
import { InactiveUsersPanel } from '../components/InactiveUsersPanel.js';

let service: InactiveUsersService | null = null;

export function setService(s: InactiveUsersService): void {
  service = s;
}

export const command: SlashCommand = {
  type: 'slash',
  data: new SlashCommandBuilder()
    .setName('inactive')
    .setDescription('View members with no chat or voice activity')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!service) {
      await interaction.reply({
        content: 'Service not initialized. Please try again later.',
        ephemeral: true,
      });
      return;
    }

    if (!interaction.guildId) {
      await interaction.reply({
        content: 'This command can only be used in a server.',
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    try {
      // Get stats overview
      const stats = await service.getInactiveStats(interaction.guildId);

      await interaction.editReply({
        embeds: [InactiveUsersPanel.createStatsEmbed(stats)],
        components: InactiveUsersPanel.createStatsComponents(),
      });
    } catch (error) {
      console.error('Inactive command error:', error);
      await interaction.editReply({
        content: `An error occurred while fetching inactive user data: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    }
  },
};
