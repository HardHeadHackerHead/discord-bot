import { GuildMember } from 'discord.js';
import { defineEvent } from '../../../types/event.types.js';
import { prisma } from '../../../core/database/prisma.js';
import { Logger } from '../../../shared/utils/logger.js';

const logger = new Logger('UserTracking:MemberAdd');

/**
 * Track users when they join a guild
 */
export const guildMemberAddEvent = defineEvent(
  'guildMemberAdd',
  async (member: GuildMember) => {
    logger.debug(`Member joined: ${member.user.username} in ${member.guild.name}`);

    try {
      // Upsert user record
      await prisma.user.upsert({
        where: { id: member.user.id },
        update: {
          username: member.user.username,
          discriminator: member.user.discriminator !== '0' ? member.user.discriminator : null,
          globalName: member.user.globalName,
          avatarHash: member.user.avatar,
          isBot: member.user.bot,
          updatedAt: new Date(),
        },
        create: {
          id: member.user.id,
          username: member.user.username,
          discriminator: member.user.discriminator !== '0' ? member.user.discriminator : null,
          globalName: member.user.globalName,
          avatarHash: member.user.avatar,
          isBot: member.user.bot,
        },
      });

      // Upsert guild member record
      await prisma.guildMember.upsert({
        where: {
          guildId_userId: {
            guildId: member.guild.id,
            userId: member.user.id,
          },
        },
        update: {
          nickname: member.nickname,
          isActive: true,
          leftAt: null,
          joinedAt: member.joinedAt || new Date(),
        },
        create: {
          guildId: member.guild.id,
          userId: member.user.id,
          nickname: member.nickname,
          joinedAt: member.joinedAt || new Date(),
        },
      });

      logger.debug(`Tracked member: ${member.user.username} (${member.user.id})`);

    } catch (error) {
      logger.error(`Failed to track member ${member.user.id}:`, error);
    }
  }
);
