import { GuildMember } from 'discord.js';
import { defineEvent } from '../../../types/event.types.js';
import { getServerStatsService } from '../services/ServerStatsService.js';
import { Logger } from '../../../shared/utils/logger.js';

const logger = new Logger('ServerStats:MemberAdd');

/**
 * Update stats channels when a member joins
 */
export const guildMemberAddEvent = defineEvent(
  'guildMemberAdd',
  async (member: GuildMember) => {
    const service = getServerStatsService();
    if (!service) return;

    try {
      // Update all stats channels for this guild
      await service.updateGuildStats(member.client, member.guild.id);
      logger.debug(`Updated stats for ${member.guild.name} after member join`);
    } catch (error) {
      logger.error(`Failed to update stats after member join:`, error);
    }
  }
);
