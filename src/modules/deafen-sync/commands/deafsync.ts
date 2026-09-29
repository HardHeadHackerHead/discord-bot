import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
} from 'discord.js';
import { defineSlashCommand } from '../../../types/command.types.js';
import { createEmbed, COLORS, successEmbed, errorEmbed, infoEmbed } from '../../../shared/utils/embed.js';
import { DeafenSyncService } from '../services/DeafenSyncService.js';

let deafenSyncService: DeafenSyncService | null = null;

export function setDeafenSyncService(service: DeafenSyncService): void {
  deafenSyncService = service;
}

export const command = defineSlashCommand(
  new SlashCommandBuilder()
    .setName('deafsync')
    .setDescription('Mirror a user\'s client deafen as a real server deafen')
    .addSubcommand((sub) =>
      sub
        .setName('add')
        .setDescription('Server-deafen this user whenever their client is deafened')
        .addUserOption((opt) => opt.setName('user').setDescription('User to watch').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('Stop syncing this user\'s deafen')
        .addUserOption((opt) => opt.setName('user').setDescription('User to stop watching').setRequired(true))
    )
    .addSubcommand((sub) => sub.setName('list').setDescription('Show users with deafen sync enabled'))
    .setDefaultMemberPermissions(PermissionFlagsBits.DeafenMembers),

  async (interaction: ChatInputCommandInteraction) => {
    const guild = interaction.guild;
    if (!deafenSyncService || !guild) {
      await interaction.reply({
        embeds: [errorEmbed('Error', 'Deafen sync is not available')],
        ephemeral: true,
      });
      return;
    }

    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'list') {
      const users = deafenSyncService.list(guild.id);
      const embed = createEmbed(COLORS.primary)
        .setTitle('🎧 Deafen Sync')
        .setDescription(
          users.length > 0
            ? users.map((u) => `• <@${u.user_id}>${u.bot_deafened ? ' — 🔇 currently server-deafened' : ''}`).join('\n')
            : 'No users are being synced.'
        );
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }

    const user = interaction.options.getUser('user', true);

    if (subcommand === 'add') {
      if (user.bot) {
        await interaction.reply({ embeds: [errorEmbed('Invalid user', 'Bots can\'t be synced.')], ephemeral: true });
        return;
      }
      if (!guild.members.me?.permissions.has(PermissionFlagsBits.DeafenMembers)) {
        await interaction.reply({
          embeds: [errorEmbed('Missing permission', 'I need the **Deafen Members** permission to do this.')],
          ephemeral: true,
        });
        return;
      }

      const added = await deafenSyncService.add(guild.id, user.id, interaction.user.id);
      if (!added) {
        await interaction.reply({ embeds: [infoEmbed('Already synced', `${user} is already on the list.`)], ephemeral: true });
        return;
      }

      // Apply immediately if they're already sitting deafened in voice
      const state = guild.voiceStates.cache.get(user.id);
      if (state?.channelId) await deafenSyncService.sync(state);

      await interaction.reply({
        embeds: [successEmbed('Deafen sync enabled', `${user} will be server-deafened whenever their client is deafened.`)],
        ephemeral: true,
      });
      return;
    }

    if (subcommand === 'remove') {
      const result = await deafenSyncService.remove(guild.id, user.id, guild.voiceStates.cache.get(user.id) ?? null);
      const messages = {
        'not-found': `${user} isn't on the list.`,
        removed: `${user} is no longer synced.`,
        released: `${user} is no longer synced, and their server deafen has been lifted.`,
        'pending-release': `${user} is no longer synced. Their server deafen will be lifted next time they join voice.`,
      };
      const embed = result === 'not-found'
        ? infoEmbed('Not synced', messages[result])
        : successEmbed('Deafen sync disabled', messages[result]);
      await interaction.reply({ embeds: [embed], ephemeral: true });
    }
  },
  {
    guildOnly: true,
  }
);
