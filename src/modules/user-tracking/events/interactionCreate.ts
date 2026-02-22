import { Interaction } from 'discord.js';
import { defineEvent } from '../../../types/event.types.js';
import { prisma } from '../../../core/database/prisma.js';
import { Logger } from '../../../shared/utils/logger.js';

const logger = new Logger('UserTracking:Interaction');

/**
 * Track users when they interact with the bot
 * This ensures users are tracked even if they joined before the bot
 */
export const interactionCreateEvent = defineEvent(
  'interactionCreate',
  async (interaction: Interaction) => {
    // Only track in guilds
    if (!interaction.guildId) return;

    const user = interaction.user;

    try {
      // Check if user exists in database
      const existingUser = await prisma.user.findUnique({
        where: { id: user.id },
      });

      // If user doesn't exist, create them
      if (!existingUser) {
        await prisma.user.create({
          data: {
            id: user.id,
            username: user.username,
            discriminator: user.discriminator !== '0' ? user.discriminator : null,
            globalName: user.globalName,
            avatarHash: user.avatar,
            isBot: user.bot,
          },
        });

        logger.debug(`Created user from interaction: ${user.username} (${user.id})`);
      }

      // Check if guild member record exists
      const existingMember = await prisma.guildMember.findUnique({
        where: {
          guildId_userId: {
            guildId: interaction.guildId,
            userId: user.id,
          },
        },
      });

      // If guild member doesn't exist, create them
      if (!existingMember && interaction.guild) {
        try {
          const guildMember = await interaction.guild.members.fetch(user.id);

          await prisma.guildMember.create({
            data: {
              guildId: interaction.guildId,
              userId: user.id,
              nickname: guildMember.nickname,
              joinedAt: guildMember.joinedAt || new Date(),
            },
          });

          logger.debug(`Created guild member from interaction: ${user.username} in ${interaction.guild.name}`);

        } catch {
          // Could not fetch guild member - create basic record
          await prisma.guildMember.create({
            data: {
              guildId: interaction.guildId,
              userId: user.id,
            },
          });
        }
      }

    } catch (error) {
      // Ignore unique constraint errors (race conditions)
      if ((error as { code?: string }).code !== 'P2002') {
        logger.error(`Failed to track user from interaction:`, error);
      }
    }
  }
);
