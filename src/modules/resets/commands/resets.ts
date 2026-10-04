import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  ChannelType,
  PermissionFlagsBits,
  MessageFlags,
} from 'discord.js';
import { defineSlashCommand } from '../../../types/command.types.js';
import { errorEmbed, successEmbed, infoEmbed } from '../../../shared/utils/embed.js';
import { ResetsService, Provider } from '../services/ResetsService.js';
import { resetStatusEmbed } from '../embeds.js';

let resetsService: ResetsService | null = null;

export function setResetsService(service: ResetsService): void {
  resetsService = service;
}

const ephemeral = MessageFlags.Ephemeral;

export const command = defineSlashCommand(
  new SlashCommandBuilder()
    .setName('resets')
    .setDescription('Usage limit resets for Claude Code and ChatGPT Codex')
    .addSubcommand((sub) =>
      sub.setName('claude').setDescription('Latest Claude Code usage limit resets')
    )
    .addSubcommand((sub) =>
      sub.setName('codex').setDescription('Latest ChatGPT Codex usage limit resets')
    )
    .addSubcommand((sub) =>
      sub
        .setName('setchannel')
        .setDescription('Post an alert in a channel as soon as a reset happens (Manage Server)')
        .addChannelOption((opt) =>
          opt
            .setName('channel')
            .setDescription('Channel for reset alerts')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
        .addRoleOption((opt) => opt.setName('role').setDescription('Role to ping on each reset'))
        .addBooleanOption((opt) => opt.setName('claude').setDescription('Alert on Claude Code resets (default: yes)'))
        .addBooleanOption((opt) => opt.setName('codex').setDescription('Alert on Codex resets (default: yes)'))
    )
    .addSubcommand((sub) =>
      sub.setName('clearchannel').setDescription('Stop posting reset alerts in this server (Manage Server)')
    ),

  async (interaction: ChatInputCommandInteraction) => {
    if (!resetsService) {
      await interaction.reply({ embeds: [errorEmbed('Error', 'Resets is not available')], flags: ephemeral });
      return;
    }

    const sub = interaction.options.getSubcommand();

    if (sub === 'claude' || sub === 'codex') {
      await interaction.deferReply();
      try {
        const snapshot = await resetsService.get(sub as Provider);
        await interaction.editReply({ embeds: [resetStatusEmbed(sub as Provider, snapshot)] });
      } catch {
        await interaction.editReply({
          embeds: [errorEmbed('Unavailable', `Couldn't reach the ${sub} resets site right now. Try again in a minute.`)],
        });
      }
      return;
    }

    // Alert configuration is guild-scoped and admin-only
    if (!interaction.guildId || !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      await interaction.reply({
        embeds: [errorEmbed('Insufficient permissions', 'Requires **Manage Server**.')],
        flags: ephemeral,
      });
      return;
    }

    if (sub === 'setchannel') {
      const channel = interaction.options.getChannel('channel', true);
      const role = interaction.options.getRole('role');
      const claude = interaction.options.getBoolean('claude') ?? true;
      const codex = interaction.options.getBoolean('codex') ?? true;

      if (!claude && !codex) {
        await interaction.reply({
          embeds: [errorEmbed('Nothing to alert on', 'Enable at least one of Claude or Codex.')],
          flags: ephemeral,
        });
        return;
      }

      await resetsService.setConfig(interaction.guildId, channel.id, {
        pingRoleId: role?.id ?? null,
        claude,
        codex,
      });

      const sources = [claude && 'Claude Code', codex && 'ChatGPT Codex'].filter(Boolean).join(' and ');
      await interaction.reply({
        embeds: [
          successEmbed(
            'Reset alerts enabled',
            `I'll post in <#${channel.id}> whenever ${sources} limits reset${role ? `, pinging <@&${role.id}>` : ''}.`
          ),
        ],
        flags: ephemeral,
      });
      return;
    }

    if (sub === 'clearchannel') {
      const removed = await resetsService.clearConfig(interaction.guildId);
      await interaction.reply({
        embeds: [
          removed
            ? successEmbed('Reset alerts disabled', 'I will no longer post reset alerts in this server.')
            : infoEmbed('Not enabled', 'Reset alerts were not set up in this server.'),
        ],
        flags: ephemeral,
      });
    }
  },
  { guildOnly: true }
);
