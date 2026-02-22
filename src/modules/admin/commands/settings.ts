import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
} from 'discord.js';
import { defineSlashCommand } from '../../../types/command.types.js';
import { SettingsPanel } from '../components/SettingsPanel.js';
import { settingsRegistry } from '../../../core/settings/SettingsDefinition.js';
import { getModuleSettingsService } from '../../../core/settings/ModuleSettingsService.js';
import { errorEmbed } from '../../../shared/utils/embed.js';

/**
 * /settings command - View and manage module settings
 *
 * Shows an interactive panel with:
 * - List of modules with configurable settings
 * - Settings for each module with current values
 * - Ability to edit and reset settings
 *
 * Requires Administrator permission.
 */
export const command = defineSlashCommand(
  new SlashCommandBuilder()
    .setName('settings')
    .setDescription('View and manage module settings')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator) as SlashCommandBuilder,

  async (interaction: ChatInputCommandInteraction) => {
    const settingsService = getModuleSettingsService();

    if (!settingsService) {
      await interaction.reply({
        embeds: [errorEmbed('Error', 'Settings service is not available.')],
        ephemeral: true,
      });
      return;
    }

    // Check if any modules have settings
    const modules = settingsRegistry.getModulesWithSettings();

    if (modules.length === 0) {
      await interaction.reply({
        embeds: [errorEmbed('No Settings Available', 'No modules have registered configurable settings.')],
        ephemeral: true,
      });
      return;
    }

    // Show module list
    const embed = SettingsPanel.createModuleListEmbed();
    const components = SettingsPanel.createModuleListComponents();

    await interaction.reply({
      embeds: [embed],
      components,
      ephemeral: true,
    });
  },
  {
    guildOnly: true,
    permissions: [PermissionFlagsBits.Administrator],
  }
);
