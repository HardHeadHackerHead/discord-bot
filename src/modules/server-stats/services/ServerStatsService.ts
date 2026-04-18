import { DatabaseService, RowDataPacket } from '../../../core/database/postgres.js';
import { Logger } from '../../../shared/utils/logger.js';
import { Client, Guild, ChannelType, VoiceChannel } from 'discord.js';

const logger = new Logger('ServerStats');

export type StatType = 'members' | 'online' | 'bots' | 'humans' | 'channels' | 'roles';

export interface StatsChannel {
  id: number;
  guild_id: string;
  channel_id: string;
  stat_type: StatType;
  name_template: string;
  created_at: Date;
  updated_at: Date;
}

export class ServerStatsService {
  constructor(private db: DatabaseService) {}

  /**
   * Create a new stats channel
   */
  async createStatsChannel(
    guildId: string,
    channelId: string,
    statType: StatType,
    nameTemplate: string
  ): Promise<void> {
    await this.db.execute(
      `INSERT INTO serverstats_channels (guild_id, channel_id, stat_type, name_template)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (channel_id) DO UPDATE SET stat_type = EXCLUDED.stat_type, name_template = EXCLUDED.name_template`,
      [guildId, channelId, statType, nameTemplate]
    );
    logger.info(`Created stats channel for guild ${guildId}: ${statType}`);
  }

  /**
   * Get all stats channels for a guild
   */
  async getGuildStatsChannels(guildId: string): Promise<StatsChannel[]> {
    const rows = await this.db.query<RowDataPacket[]>(
      'SELECT * FROM serverstats_channels WHERE guild_id = ?',
      [guildId]
    );
    return rows as StatsChannel[];
  }

  /**
   * Get a stats channel by ID
   */
  async getStatsChannel(channelId: string): Promise<StatsChannel | null> {
    const rows = await this.db.query<RowDataPacket[]>(
      'SELECT * FROM serverstats_channels WHERE channel_id = ?',
      [channelId]
    );
    return (rows[0] as StatsChannel) || null;
  }

  /**
   * Delete a stats channel
   */
  async deleteStatsChannel(channelId: string): Promise<boolean> {
    const result = await this.db.execute(
      'DELETE FROM serverstats_channels WHERE channel_id = ?',
      [channelId]
    );
    return (result as { affectedRows: number }).affectedRows > 0;
  }

  /**
   * Delete all stats channels for a guild
   */
  async deleteGuildStatsChannels(guildId: string): Promise<number> {
    const result = await this.db.execute(
      'DELETE FROM serverstats_channels WHERE guild_id = ?',
      [guildId]
    );
    return (result as { affectedRows: number }).affectedRows;
  }

  /**
   * Get the stat value for a guild
   */
  getStatValue(guild: Guild, statType: StatType): number {
    switch (statType) {
      case 'members':
        return guild.memberCount;
      case 'online':
        return guild.members.cache.filter(m => m.presence?.status !== 'offline').size;
      case 'bots':
        return guild.members.cache.filter(m => m.user.bot).size;
      case 'humans':
        return guild.members.cache.filter(m => !m.user.bot).size;
      case 'channels':
        return guild.channels.cache.size;
      case 'roles':
        return guild.roles.cache.size;
      default:
        return 0;
    }
  }

  /**
   * Format the channel name with the stat value
   */
  formatChannelName(template: string, value: number): string {
    return template.replace('{count}', value.toLocaleString());
  }

  /**
   * Update a single stats channel
   */
  async updateStatsChannel(client: Client, statsChannel: StatsChannel): Promise<boolean> {
    try {
      const guild = client.guilds.cache.get(statsChannel.guild_id);
      if (!guild) {
        logger.debug(`Guild ${statsChannel.guild_id} not found, skipping update`);
        return false;
      }

      const channel = guild.channels.cache.get(statsChannel.channel_id);
      if (!channel || channel.type !== ChannelType.GuildVoice) {
        logger.debug(`Channel ${statsChannel.channel_id} not found or not a voice channel`);
        // Clean up the database entry if channel no longer exists
        await this.deleteStatsChannel(statsChannel.channel_id);
        return false;
      }

      const voiceChannel = channel as VoiceChannel;
      const value = this.getStatValue(guild, statsChannel.stat_type);
      const newName = this.formatChannelName(statsChannel.name_template, value);

      // Only update if name changed
      if (voiceChannel.name !== newName) {
        await voiceChannel.setName(newName);
        logger.debug(`Updated ${statsChannel.stat_type} channel for ${guild.name}: ${newName}`);
      }

      return true;
    } catch (error) {
      logger.error(`Failed to update stats channel ${statsChannel.channel_id}:`, error);
      return false;
    }
  }

  /**
   * Update all stats channels for a guild
   */
  async updateGuildStats(client: Client, guildId: string): Promise<void> {
    const channels = await this.getGuildStatsChannels(guildId);

    for (const channel of channels) {
      await this.updateStatsChannel(client, channel);
    }
  }

  /**
   * Update all stats channels across all guilds
   */
  async updateAllStats(client: Client): Promise<void> {
    const rows = await this.db.query<RowDataPacket[]>(
      'SELECT DISTINCT guild_id FROM serverstats_channels'
    );

    for (const row of rows) {
      await this.updateGuildStats(client, row['guild_id']);
    }
  }

  /**
   * Get all stats channels from database
   */
  async getAllStatsChannels(): Promise<StatsChannel[]> {
    const rows = await this.db.query<RowDataPacket[]>(
      'SELECT * FROM serverstats_channels'
    );
    return rows as StatsChannel[];
  }
}

// Singleton instance
let serverStatsService: ServerStatsService | null = null;

export function initServerStatsService(db: DatabaseService): ServerStatsService {
  serverStatsService = new ServerStatsService(db);
  return serverStatsService;
}

export function getServerStatsService(): ServerStatsService | null {
  return serverStatsService;
}
