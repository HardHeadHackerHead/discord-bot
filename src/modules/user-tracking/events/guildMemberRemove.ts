import { GuildMember, PartialGuildMember } from 'discord.js';
import { defineEvent } from '../../../types/event.types.js';
import { prisma } from '../../../core/database/prisma.js';
import { Logger } from '../../../shared/utils/logger.js';

const logger = new Logger('UserTracking:MemberRemove');

/**
 * Track when users leave a guild
 */
export const guildMemberRemoveEvent = defineEvent(
  'guildMemberRemove',
  async (member: GuildMember | PartialGuildMember) => {
    logger.debug(`Member left: ${member.user?.username || 'unknown'} from ${member.guild.name}`);

    try {
      // Update guild member record to mark as inactive
      await prisma.guildMember.updateMany({
        where: {
          guildId: member.guild.id,
          userId: member.user?.id || member.id,
        },
        data: {
          isActive: false,
          leftAt: new Date(),
        },
      });

      logger.debug(`Marked member as left: ${member.user?.id || member.id}`);

    } catch (error) {
      logger.error(`Failed to update member leave:`, error);
    }
  }
);
