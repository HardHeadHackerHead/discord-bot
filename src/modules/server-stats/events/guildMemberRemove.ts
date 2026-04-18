import { GuildMember, PartialGuildMember } from 'discord.js';
import { defineEvent } from '../../../types/event.types.js';
import { getServerStatsService } from '../services/ServerStatsService.js';
import { Logger } from '../../../shared/utils/logger.js';

const logger = new Logger('ServerStats:MemberRemove');

/**
 * Update stats channels when a member leaves
 */
export const guildMemberRemoveEvent = defineEvent(
  'guildMemberRemove',
  async (member: GuildMember | PartialGuildMember) => {
    const service = getServerStatsService();
    if (!service) return;

    try {
      // Update all stats channels for this guild
      await service.updateGuildStats(member.client, member.guild.id);
      logger.debug(`Updated stats for ${member.guild.name} after member leave`);
    } catch (error) {
      logger.error(`Failed to update stats after member leave:`, error);
    }
  }
);
