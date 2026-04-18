import { DatabaseService, RowDataPacket } from '../../../core/database/postgres.js';
import { Logger } from '../../../shared/utils/logger.js';
import { randomUUID } from 'crypto';

const logger = new Logger('SocialFeeds:Service');

/**
 * Supported social media platforms
 * Extensible - add more platforms as needed
 */
export type SocialPlatform = 'youtube';

/**
 * Feed configuration stored in database
 */
export interface FeedConfig {
  id: string;
  guild_id: string;
  platform: SocialPlatform;
  platform_id: string;
  platform_name: string | null;
  channel_id: string;
  custom_message: string | null;
  enabled: boolean;
  created_at: Date;
  updated_at: Date;
}

/**
 * Posted item record (to prevent duplicate posts)
 */
export interface PostedItem {
  id: string;
  feed_config_id: string;
  item_id: string;
  title: string | null;
  url: string | null;
  posted_at: Date;
}

/**
 * Guild settings for social feeds
 */
export interface GuildFeedSettings {
  id: string;
  guild_id: string;
  check_interval_minutes: number;
  created_at: Date;
  updated_at: Date;
}

/**
 * Feed item from RSS/API (platform-agnostic)
 */
export interface FeedItem {
  id: string;
  title: string;
  url: string;
  publishedAt: Date;
  author?: string;
  thumbnail?: string;
}

/**
 * Service for managing social media feed configurations and posted items
 */
export class SocialFeedsService {
  private moduleId = 'social-feeds';

  constructor(private db: DatabaseService) {}

  // ==================== Feed Configuration ====================

  /**
   * Add a new feed configuration
   */
  async addFeed(
    guildId: string,
    platform: SocialPlatform,
    platformId: string,
    channelId: string,
    platformName?: string,
    customMessage?: string
  ): Promise<FeedConfig> {
    const id = randomUUID();

    await this.db.execute(
      `INSERT INTO socialfeeds_feed_configs
       (id, guild_id, platform, platform_id, platform_name, channel_id, custom_message, enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, TRUE)`,
      [id, guildId, platform, platformId, platformName || null, channelId, customMessage || null]
    );

    logger.info(`Added ${platform} feed for ${platformId} in guild ${guildId}`);

    return {
      id,
      guild_id: guildId,
      platform,
      platform_id: platformId,
      platform_name: platformName || null,
      channel_id: channelId,
      custom_message: customMessage || null,
      enabled: true,
      created_at: new Date(),
      updated_at: new Date(),
    };
  }

  /**
   * Remove a feed configuration
   */
  async removeFeed(feedId: string): Promise<boolean> {
    const result = await this.db.execute(
      'DELETE FROM socialfeeds_feed_configs WHERE id = ?',
      [feedId]
    );
    return result.affectedRows > 0;
  }

  /**
   * Get a specific feed by ID
   */
  async getFeed(feedId: string): Promise<FeedConfig | null> {
    const rows = await this.db.query<(FeedConfig & RowDataPacket)[]>(
      'SELECT * FROM socialfeeds_feed_configs WHERE id = ?',
      [feedId]
    );
    return rows[0] || null;
  }

  /**
   * Get all feeds for a guild
   */
  async getGuildFeeds(guildId: string): Promise<FeedConfig[]> {
    return this.db.query<(FeedConfig & RowDataPacket)[]>(
      'SELECT * FROM socialfeeds_feed_configs WHERE guild_id = ? ORDER BY created_at DESC',
      [guildId]
    );
  }

  /**
   * Get all enabled feeds (across all guilds) for a specific platform
   */
  async getEnabledFeedsByPlatform(platform: SocialPlatform): Promise<FeedConfig[]> {
    return this.db.query<(FeedConfig & RowDataPacket)[]>(
      'SELECT * FROM socialfeeds_feed_configs WHERE platform = ? AND enabled = TRUE',
      [platform]
    );
  }

  /**
   * Get all enabled feeds (across all guilds)
   */
  async getAllEnabledFeeds(): Promise<FeedConfig[]> {
    return this.db.query<(FeedConfig & RowDataPacket)[]>(
      'SELECT * FROM socialfeeds_feed_configs WHERE enabled = TRUE'
    );
  }

  /**
   * Enable or disable a feed
   */
  async setFeedEnabled(feedId: string, enabled: boolean): Promise<boolean> {
    const result = await this.db.execute(
      'UPDATE socialfeeds_feed_configs SET enabled = ?, updated_at = NOW() WHERE id = ?',
      [enabled, feedId]
    );
    return result.affectedRows > 0;
  }

  /**
   * Update feed channel
   */
  async updateFeedChannel(feedId: string, channelId: string): Promise<boolean> {
    const result = await this.db.execute(
      'UPDATE socialfeeds_feed_configs SET channel_id = ?, updated_at = NOW() WHERE id = ?',
      [channelId, feedId]
    );
    return result.affectedRows > 0;
  }

  /**
   * Update feed custom message
   */
  async updateFeedMessage(feedId: string, customMessage: string | null): Promise<boolean> {
    const result = await this.db.execute(
      'UPDATE socialfeeds_feed_configs SET custom_message = ?, updated_at = NOW() WHERE id = ?',
      [customMessage, feedId]
    );
    return result.affectedRows > 0;
  }

  /**
   * Check if a feed already exists for this guild/platform/id combination
   */
  async feedExists(guildId: string, platform: SocialPlatform, platformId: string): Promise<boolean> {
    const rows = await this.db.query<({ count: number } & RowDataPacket)[]>(
      `SELECT COUNT(*) as count FROM socialfeeds_feed_configs
       WHERE guild_id = ? AND platform = ? AND platform_id = ?`,
      [guildId, platform, platformId]
    );
    return (rows[0]?.count ?? 0) > 0;
  }

  // ==================== Posted Items (Duplicate Prevention) ====================

  /**
   * Check if an item has already been posted
   */
  async isItemPosted(feedConfigId: string, itemId: string): Promise<boolean> {
    const rows = await this.db.query<({ count: number } & RowDataPacket)[]>(
      `SELECT COUNT(*) as count FROM socialfeeds_posted_items
       WHERE feed_config_id = ? AND item_id = ?`,
      [feedConfigId, itemId]
    );
    return (rows[0]?.count ?? 0) > 0;
  }

  /**
   * Mark an item as posted
   */
  async markItemPosted(
    feedConfigId: string,
    itemId: string,
    title?: string,
    url?: string
  ): Promise<void> {
    const id = randomUUID();
    await this.db.execute(
      `INSERT INTO socialfeeds_posted_items (id, feed_config_id, item_id, title, url)
       VALUES (?, ?, ?, ?, ?)`,
      [id, feedConfigId, itemId, title || null, url || null]
    );
  }

  /**
   * Get recent posted items for a feed
   */
  async getRecentPostedItems(feedConfigId: string, limit: number = 10): Promise<PostedItem[]> {
    const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
    return this.db.query<(PostedItem & RowDataPacket)[]>(
      `SELECT * FROM socialfeeds_posted_items
       WHERE feed_config_id = ?
       ORDER BY posted_at DESC
       LIMIT ${safeLimit}`,
      [feedConfigId]
    );
  }

  /**
   * Clean up old posted items (older than X days)
   * This prevents the table from growing indefinitely
   */
  async cleanupOldPostedItems(daysToKeep: number = 30): Promise<number> {
    const result = await this.db.execute(
      `DELETE FROM socialfeeds_posted_items
       WHERE posted_at < NOW() - MAKE_INTERVAL(days => ?)`,
      [daysToKeep]
    );
    if (result.affectedRows > 0) {
      logger.debug(`Cleaned up ${result.affectedRows} old posted items`);
    }
    return result.affectedRows;
  }

  // ==================== Guild Settings ====================

  /**
   * Get guild settings (creates default if not exists)
   */
  async getGuildSettings(guildId: string): Promise<GuildFeedSettings> {
    const rows = await this.db.query<(GuildFeedSettings & RowDataPacket)[]>(
      'SELECT * FROM socialfeeds_guild_settings WHERE guild_id = ?',
      [guildId]
    );

    if (rows[0]) return rows[0];

    // Create default settings
    const id = randomUUID();
    await this.db.execute(
      `INSERT INTO socialfeeds_guild_settings (id, guild_id, check_interval_minutes)
       VALUES (?, ?, 15)`,
      [id, guildId]
    );

    return {
      id,
      guild_id: guildId,
      check_interval_minutes: 15,
      created_at: new Date(),
      updated_at: new Date(),
    };
  }

  /**
   * Update guild settings
   */
  async updateGuildSettings(
    guildId: string,
    settings: Partial<Pick<GuildFeedSettings, 'check_interval_minutes'>>
  ): Promise<void> {
    await this.getGuildSettings(guildId); // Ensure exists

    if (settings.check_interval_minutes !== undefined) {
      await this.db.execute(
        `UPDATE socialfeeds_guild_settings
         SET check_interval_minutes = ?, updated_at = NOW()
         WHERE guild_id = ?`,
        [settings.check_interval_minutes, guildId]
      );
    }
  }

  // ==================== Statistics ====================

  /**
   * Get feed count for a guild
   */
  async getGuildFeedCount(guildId: string): Promise<number> {
    const rows = await this.db.query<({ count: number } & RowDataPacket)[]>(
      'SELECT COUNT(*) as count FROM socialfeeds_feed_configs WHERE guild_id = ?',
      [guildId]
    );
    return rows[0]?.count ?? 0;
  }

  /**
   * Get total posts made for a feed
   */
  async getFeedPostCount(feedConfigId: string): Promise<number> {
    const rows = await this.db.query<({ count: number } & RowDataPacket)[]>(
      'SELECT COUNT(*) as count FROM socialfeeds_posted_items WHERE feed_config_id = ?',
      [feedConfigId]
    );
    return rows[0]?.count ?? 0;
  }
}
