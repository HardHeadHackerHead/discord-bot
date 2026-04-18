import { DMChannel, GuildChannel } from 'discord.js';
import { defineEvent } from '../../../types/event.types.js';
import { getServerStatsService } from '../services/ServerStatsService.js';
import { Logger } from '../../../shared/utils/logger.js';

const logger = new Logger('ServerStats:ChannelDelete');

/**
 * Clean up database when a stats channel is deleted externally
 */
export const channelDeleteEvent = defineEvent(
  'channelDelete',
  async (channel: DMChannel | GuildChannel) => {
    // Ignore DM channels
    if (channel.isDMBased()) return;

    const service = getServerStatsService();
    if (!service) return;

    try {
      // Check if this was a stats channel and remove from database
      const statsChannel = await service.getStatsChannel(channel.id);
      if (statsChannel) {
        await service.deleteStatsChannel(channel.id);
        logger.info(`Cleaned up deleted stats channel: ${statsChannel.stat_type}`);
      }
    } catch (error) {
      logger.error(`Failed to clean up deleted channel:`, error);
    }
  }
);
