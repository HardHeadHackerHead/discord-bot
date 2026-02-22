import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  User,
} from 'discord.js';
import { defineSlashCommand } from '../../../types/command.types.js';
import { createEmbed, COLORS, errorEmbed } from '../../../shared/utils/embed.js';
import { discordTimestamp } from '../../../shared/utils/time.js';
import { prisma } from '../../../core/database/prisma.js';

/**
 * /userinfo command - Get information about a user
 */
export const command = defineSlashCommand(
  new SlashCommandBuilder()
    .setName('userinfo')
    .setDescription('Get information about a user')
    .addUserOption((opt) =>
      opt
        .setName('user')
        .setDescription('The user to get info about (defaults to yourself)')
        .setRequired(false)
    ) as SlashCommandBuilder,

  async (interaction: ChatInputCommandInteraction) => {
    const targetUser = interaction.options.getUser('user') || interaction.user;
    const guildId = interaction.guildId;

    // Get user from database
    const dbUser = await prisma.user.findUnique({
      where: { id: targetUser.id },
      include: {
        guildMembers: guildId ? {
          where: { guildId },
        } : false,
      },
    });

    // Build embed
    const embed = createEmbed(COLORS.primary)
      .setTitle(`User Info: ${targetUser.displayName}`)
      .setThumbnail(targetUser.displayAvatarURL({ size: 256 }))
      .addFields(
        { name: 'Username', value: targetUser.username, inline: true },
        { name: 'ID', value: `\`${targetUser.id}\``, inline: true },
        { name: 'Bot', value: targetUser.bot ? 'Yes' : 'No', inline: true },
      );

    // Discord account info
    embed.addFields({
      name: 'Account Created',
      value: discordTimestamp(targetUser.createdAt, 'R'),
      inline: true,
    });

    // Database info
    if (dbUser) {
      embed.addFields({
        name: 'First Seen',
        value: discordTimestamp(dbUser.firstSeenAt, 'R'),
        inline: true,
      });

      // Guild member info
      if (guildId && dbUser.guildMembers && dbUser.guildMembers.length > 0) {
        const member = dbUser.guildMembers[0];
        if (member) {
          embed.addFields({
            name: 'Joined Server',
            value: discordTimestamp(member.joinedAt, 'R'),
            inline: true,
          });

          if (member.nickname) {
            embed.addFields({
              name: 'Server Nickname',
              value: member.nickname,
              inline: true,
            });
          }
        }
      }
    } else {
      embed.addFields({
        name: 'Database Status',
        value: '*Not tracked yet*',
        inline: true,
      });
    }

    // Try to get guild member for role info
    if (guildId) {
      try {
        const guildMember = await interaction.guild?.members.fetch(targetUser.id);
        if (guildMember) {
          const roles = guildMember.roles.cache
            .filter(r => r.id !== guildId) // Filter out @everyone
            .sort((a, b) => b.position - a.position)
            .map(r => r.toString())
            .slice(0, 10); // Limit to 10 roles

          if (roles.length > 0) {
            const roleCount = guildMember.roles.cache.size - 1;
            embed.addFields({
              name: `Roles (${roleCount})`,
              value: roles.join(', ') + (roleCount > 10 ? '...' : ''),
            });
          }

          // Highest role color
          if (guildMember.displayColor !== 0) {
            embed.setColor(guildMember.displayColor);
          }
        }
      } catch {
        // User might not be in the guild
      }
    }

    await interaction.reply({ embeds: [embed] });
  },
  {
    guildOnly: false, // Can be used in DMs too
  }
);
