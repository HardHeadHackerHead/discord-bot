import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
} from 'discord.js';
import { defineSlashCommand } from '../../../types/command.types.js';
import { successEmbed, errorEmbed, loadingEmbed } from '../../../shared/utils/embed.js';
import { requireBotOwner } from '../../../shared/utils/permissions.js';
import { getClient } from '../../../bot.js';
import { isDevelopment } from '../../../config/environment.js';

/**
 * /reload command - Hot-reload modules (development only)
 */
export const command = defineSlashCommand(
  new SlashCommandBuilder()
    .setName('reload')
    .setDescription('Hot-reload a module (development only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption((opt) =>
      opt
        .setName('module')
        .setDescription('The module to reload')
        .setRequired(true)
        .setAutocomplete(true)
    ) as SlashCommandBuilder,

  async (interaction: ChatInputCommandInteraction) => {
    // Only allow in development mode
    if (!isDevelopment) {
      await interaction.reply({
        embeds: [errorEmbed('Development Only', 'Module hot-reload is only available in development mode.')],
        ephemeral: true,
      });
      return;
    }

    // Require bot owner (not just server admin)
    if (!(await requireBotOwner(interaction))) {
      return;
    }

    const moduleId = interaction.options.getString('module', true);
    const client = getClient();

    // Check if module exists
    if (!client.modules.isLoaded(moduleId)) {
      await interaction.reply({
        embeds: [errorEmbed('Module Not Found', `Module \`${moduleId}\` is not loaded.`)],
        ephemeral: true,
      });
      return;
    }

    // Show loading message
    await interaction.reply({
      embeds: [loadingEmbed(`Reloading module \`${moduleId}\`...`)],
    });

    try {
      const success = await client.modules.reloadModule(moduleId);

      if (success) {
        const module = client.modules.getModule(moduleId);

        // Re-deploy commands to update Discord
        await client.commands.deployCommands();

        await interaction.editReply({
          embeds: [successEmbed(
            'Module Reloaded',
            `Module **${module?.metadata.name || moduleId}** has been hot-reloaded successfully.\n\n` +
            `Commands: ${module?.commands.length || 0}\n` +
            `Events: ${module?.events.length || 0}`
          )],
        });
      } else {
        await interaction.editReply({
          embeds: [errorEmbed('Reload Failed', `Failed to reload module \`${moduleId}\`. Check logs for details.`)],
        });
      }

    } catch (error) {
      await interaction.editReply({
        embeds: [errorEmbed('Reload Error', error instanceof Error ? error.message : 'Unknown error')],
      });
    }
  },
  {
    guildOnly: true,
    autocomplete: async (interaction) => {
      const client = getClient();
      const focusedValue = interaction.options.getFocused().toLowerCase();

      const moduleIds = client.modules.getLoadedModuleIds();
      const choices = moduleIds
        .filter(id => id.toLowerCase().includes(focusedValue))
        .map(id => {
          const module = client.modules.getModule(id);
          return {
            name: module ? `${module.metadata.name} (${id})` : id,
            value: id,
          };
        })
        .slice(0, 25);

      await interaction.respond(choices);
    },
  }
);
