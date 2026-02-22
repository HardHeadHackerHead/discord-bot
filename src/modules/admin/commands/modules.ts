import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  GuildMember,
} from 'discord.js';
import { defineSlashCommand } from '../../../types/command.types.js';
import { getClient } from '../../../bot.js';
import { ModulesPanel, ModuleStatus } from '../components/ModulesPanel.js';

/**
 * /modules command - View and manage bot modules
 *
 * Shows an interactive panel with:
 * - List of modules with enabled/disabled status
 * - Pagination for large module lists
 * - Admin controls: select module, enable/disable buttons
 * - Non-admins only see the list (read-only)
 */
export const command = defineSlashCommand(
  new SlashCommandBuilder()
    .setName('modules')
    .setDescription('View and manage bot modules') as SlashCommandBuilder,

  async (interaction: ChatInputCommandInteraction) => {
    const client = getClient();
    const guildId = interaction.guildId!;
    const member = interaction.member as GuildMember | null;
    const isAdmin = ModulesPanel.isAdmin(member);

    // Get all discovered modules (public only for initial view)
    const allMetadata = client.modules.getAllDiscoveredModules().filter((m) => m.isPublic);

    // Get enabled status and loaded status for each
    const statuses: ModuleStatus[] = await Promise.all(
      allMetadata.map(async (metadata) => {
        const enabled = await client.modules.isEnabledForGuild(metadata.id, guildId);
        const loaded = client.modules.isLoaded(metadata.id);
        const module = loaded ? client.modules.getModule(metadata.id) : undefined;
        return { metadata, module, enabled, loaded };
      })
    );

    // Sort: enabled first, then loaded, then alphabetically
    statuses.sort((a, b) => {
      if (a.enabled !== b.enabled) {
        return a.enabled ? -1 : 1;
      }
      if (a.loaded !== b.loaded) {
        return a.loaded ? -1 : 1;
      }
      return a.metadata.name.localeCompare(b.metadata.name);
    });

    // Create initial embed and components
    const embed = ModulesPanel.createListEmbed(statuses, 0, isAdmin);
    const components = ModulesPanel.createListComponents(statuses, 0, isAdmin, false);

    await interaction.reply({
      embeds: [embed],
      components,
      ephemeral: true,
    });
  },
  {
    guildOnly: true,
  }
);
