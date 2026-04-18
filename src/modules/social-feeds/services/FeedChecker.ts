import { Client, TextChannel, EmbedBuilder } from 'discord.js';
import { SocialFeedsService, FeedConfig, FeedItem } from './SocialFeedsService.js';
import { youtubeFetcher } from './YouTubeFetcher.js';
import { Logger } from '../../../shared/utils/logger.js';

const logger = new Logger('SocialFeeds:Checker');

/**
 * Default check interval in milliseconds (15 minutes)
 */
const DEFAULT_CHECK_INTERVAL = 15 * 60 * 1000;

/**
 * Platform notification colors
 */
const PLATFORM_COLORS: Record<string, number> = {
  youtube: 0xFF0000,
};

/**
 * Platform emojis
 */
const PLATFORM_EMOJIS: Record<string, string> = {
  youtube: '📺',
};

/**
 * Feed Checker Service
 * Periodically checks all enabled feeds and posts new items to Discord
 */
export class FeedChecker {
  private client: Client;
  private feedsService: SocialFeedsService;
  private checkInterval: NodeJS.Timeout | null = null;
  private isRunning = false;
  private intervalMs: number;

  constructor(
    client: Client,
    feedsService: SocialFeedsService,
    intervalMs: number = DEFAULT_CHECK_INTERVAL
  ) {
    this.client = client;
    this.feedsService = feedsService;
    this.intervalMs = intervalMs;
  }

  /**
   * Start the feed checker
   */
  start(): void {
    if (this.checkInterval) {
      logger.warn('Feed checker is already running');
      return;
    }

    logger.info(`Starting feed checker with ${this.intervalMs / 1000 / 60} minute interval`);

    // Run immediately on start
    this.checkAllFeeds().catch(err => logger.error('Error in initial feed check:', err));

    // Then run on interval
    this.checkInterval = setInterval(() => {
      this.checkAllFeeds().catch(err => logger.error('Error in scheduled feed check:', err));
    }, this.intervalMs);
  }

  /**
   * Stop the feed checker
   */
  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
      logger.info('Feed checker stopped');
    }
  }

  /**
   * Update the check interval
   */
  setInterval(intervalMs: number): void {
    this.intervalMs = intervalMs;

    // Restart if already running
    if (this.checkInterval) {
      this.stop();
      this.start();
    }
  }

  /**
   * Check all enabled feeds for new items
   */
  async checkAllFeeds(): Promise<void> {
    if (this.isRunning) {
      logger.debug('Feed check already in progress, skipping');
      return;
    }

    this.isRunning = true;

    try {
      const feeds = await this.feedsService.getAllEnabledFeeds();

      if (feeds.length === 0) {
        logger.debug('No enabled feeds to check');
        return;
      }

      logger.debug(`Checking ${feeds.length} feed(s)`);

      // Group feeds by platform for efficient processing
      const feedsByPlatform = new Map<string, FeedConfig[]>();
      for (const feed of feeds) {
        const existing = feedsByPlatform.get(feed.platform) || [];
        existing.push(feed);
        feedsByPlatform.set(feed.platform, existing);
      }

      // Process each platform
      for (const [platform, platformFeeds] of feedsByPlatform) {
        await this.checkPlatformFeeds(platform, platformFeeds);
      }

      // Cleanup old posted items (runs periodically)
      await this.feedsService.cleanupOldPostedItems(30);

    } catch (error) {
      logger.error('Error checking feeds:', error);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Check feeds for a specific platform
   */
  private async checkPlatformFeeds(platform: string, feeds: FeedConfig[]): Promise<void> {
    switch (platform) {
      case 'youtube':
        await this.checkYouTubeFeeds(feeds);
        break;
      default:
        logger.warn(`Unknown platform: ${platform}`);
    }
  }

  /**
   * Check YouTube feeds for new videos
   */
  private async checkYouTubeFeeds(feeds: FeedConfig[]): Promise<void> {
    // Group by channel ID to reduce API calls
    const feedsByChannel = new Map<string, FeedConfig[]>();
    for (const feed of feeds) {
      const existing = feedsByChannel.get(feed.platform_id) || [];
      existing.push(feed);
      feedsByChannel.set(feed.platform_id, existing);
    }

    for (const [channelId, channelFeeds] of feedsByChannel) {
      try {
        const videos = await youtubeFetcher.fetchVideos(channelId, 10);

        if (videos.length === 0) {
          continue;
        }

        // Process each feed that watches this channel
        for (const feed of channelFeeds) {
          await this.processNewItems(feed, videos);
        }

        // Small delay between channels to avoid rate limiting
        await this.delay(1000);

      } catch (error) {
        logger.error(`Error checking YouTube channel ${channelId}:`, error);
      }
    }
  }

  /**
   * Process new items for a feed
   */
  private async processNewItems(feed: FeedConfig, items: FeedItem[]): Promise<void> {
    // Sort by publish date (oldest first) to post in chronological order
    const sortedItems = [...items].sort(
      (a, b) => a.publishedAt.getTime() - b.publishedAt.getTime()
    );

    let newItemsCount = 0;

    for (const item of sortedItems) {
      // Check if already posted
      const isPosted = await this.feedsService.isItemPosted(feed.id, item.id);
      if (isPosted) {
        continue;
      }

      // Post to Discord
      const posted = await this.postItem(feed, item);

      if (posted) {
        // Mark as posted
        await this.feedsService.markItemPosted(feed.id, item.id, item.title, item.url);
        newItemsCount++;

        // Small delay between posts
        await this.delay(500);
      }
    }

    if (newItemsCount > 0) {
      logger.info(`Posted ${newItemsCount} new item(s) for ${feed.platform}:${feed.platform_name || feed.platform_id}`);
    }
  }

  /**
   * Post an item to Discord
   */
  private async postItem(feed: FeedConfig, item: FeedItem): Promise<boolean> {
    try {
      // Get the channel
      const channel = await this.client.channels.fetch(feed.channel_id);

      if (!channel || !channel.isTextBased() || !('send' in channel)) {
        logger.warn(`Cannot post to channel ${feed.channel_id} - channel not found or not text-based`);
        return false;
      }

      const textChannel = channel as TextChannel;

      // Check if we have permissions to send
      const guild = textChannel.guild;
      const botMember = guild.members.cache.get(this.client.user!.id);
      if (!botMember) {
        logger.warn(`Bot not found in guild ${guild.id}`);
        return false;
      }

      const permissions = textChannel.permissionsFor(botMember);
      if (!permissions?.has('SendMessages') || !permissions?.has('EmbedLinks')) {
        logger.warn(`Missing permissions to post in #${textChannel.name}`);
        return false;
      }

      // Build the embed
      const color = PLATFORM_COLORS[feed.platform] || 0x5865F2;
      const emoji = PLATFORM_EMOJIS[feed.platform] || '📡';
      const platformName = this.getPlatformName(feed.platform);
      const channelName = item.author || feed.platform_name || 'Unknown';

      const embed = new EmbedBuilder()
        .setAuthor({
          name: channelName,
          url: `https://www.youtube.com/channel/${feed.platform_id}`,
        })
        .setTitle(item.title)
        .setURL(item.url)
        .setColor(color)
        .setTimestamp(item.publishedAt)
        .setFooter({ text: `${emoji} New ${platformName} Upload` });

      if (item.thumbnail) {
        embed.setImage(item.thumbnail);
      }

      // Send the message with a ping-style header
      await textChannel.send({
        content: `🔔 **${channelName}** just uploaded a new video!`,
        embeds: [embed],
      });

      return true;

    } catch (error) {
      logger.error(`Error posting item to channel ${feed.channel_id}:`, error);
      return false;
    }
  }


  /**
   * Get platform display name
   */
  private getPlatformName(platform: string): string {
    const names: Record<string, string> = {
      youtube: 'YouTube',
    };
    return names[platform] || platform;
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
