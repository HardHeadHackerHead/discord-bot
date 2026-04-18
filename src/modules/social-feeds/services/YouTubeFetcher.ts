import { XMLParser } from 'fast-xml-parser';
import { Logger } from '../../../shared/utils/logger.js';
import type { FeedItem } from './SocialFeedsService.js';

const logger = new Logger('SocialFeeds:YouTube');

/**
 * YouTube RSS feed URL format
 * Channel RSS: https://www.youtube.com/feeds/videos.xml?channel_id=CHANNEL_ID
 */
const YOUTUBE_RSS_URL = 'https://www.youtube.com/feeds/videos.xml?channel_id=';

/**
 * YouTube channel info response structure
 */
interface YouTubeChannelInfo {
  id: string;
  name: string;
  url: string;
}

/**
 * YouTube RSS entry structure (from XML parser)
 */
interface YouTubeRssEntry {
  'yt:videoId': string;
  'yt:channelId': string;
  title: string;
  link: { '@_href': string };
  author: { name: string; uri: string };
  published: string;
  updated: string;
  'media:group': {
    'media:title': string;
    'media:content': { '@_url': string; '@_type': string };
    'media:thumbnail': { '@_url': string; '@_width': string; '@_height': string };
    'media:description': string;
  };
}

/**
 * YouTube RSS feed structure (from XML parser)
 */
interface YouTubeRssFeed {
  feed: {
    title: string;
    'yt:channelId': string;
    author?: { name: string; uri: string };
    entry?: YouTubeRssEntry | YouTubeRssEntry[];
  };
}

/**
 * Fetches YouTube channel videos via RSS
 */
export class YouTubeFetcher {
  private parser: XMLParser;

  constructor() {
    this.parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
    });
  }

  /**
   * Extract channel ID from various YouTube URL formats
   * Supports:
   * - https://www.youtube.com/channel/UC...
   * - https://www.youtube.com/@handle
   * - https://www.youtube.com/c/ChannelName
   * - @handle (without URL)
   * - Direct channel ID (UC...)
   */
  async resolveChannelId(input: string): Promise<YouTubeChannelInfo | null> {
    const trimmedInput = input.trim();

    // Already a channel ID (starts with UC and is 24 chars)
    if (trimmedInput.startsWith('UC') && trimmedInput.length === 24) {
      const info = await this.getChannelInfo(trimmedInput);
      return info;
    }

    // Handle @handle format without URL
    if (trimmedInput.startsWith('@')) {
      const handleUrl = `https://www.youtube.com/${trimmedInput}`;
      return this.resolveChannelFromPage(handleUrl);
    }

    // Parse URL
    try {
      const url = new URL(trimmedInput.startsWith('http') ? trimmedInput : `https://${trimmedInput}`);

      if (url.hostname.includes('youtube.com')) {
        const pathParts = url.pathname.split('/').filter(Boolean);

        // /channel/UC... format
        if (pathParts[0] === 'channel' && pathParts[1]) {
          const info = await this.getChannelInfo(pathParts[1]);
          return info;
        }

        // /@handle or /c/name format - need to fetch the page to get channel ID
        if (pathParts[0]?.startsWith('@') || pathParts[0] === 'c' || pathParts[0] === 'user') {
          return this.resolveChannelFromPage(trimmedInput.startsWith('http') ? trimmedInput : `https://${trimmedInput}`);
        }
      }
    } catch {
      // Not a valid URL - only try as channel ID if it looks like one
      if (trimmedInput.startsWith('UC') && trimmedInput.length >= 20) {
        const info = await this.getChannelInfo(trimmedInput);
        return info;
      }
    }

    return null;
  }

  /**
   * Get channel info by fetching the RSS feed
   */
  private async getChannelInfo(channelId: string): Promise<YouTubeChannelInfo | null> {
    try {
      const response = await fetch(`${YOUTUBE_RSS_URL}${channelId}`);
      if (!response.ok) {
        logger.debug(`Failed to fetch channel ${channelId}: ${response.status}`);
        return null;
      }

      const xml = await response.text();
      const parsed = this.parser.parse(xml) as YouTubeRssFeed;

      if (!parsed.feed) {
        return null;
      }

      // Note: YouTube RSS returns channelId without 'UC' prefix, but we need the full ID
      // The channelId parameter we passed in should already have the UC prefix
      // So we prefer to use that over the RSS's yt:channelId field
      return {
        id: channelId,
        name: parsed.feed.author?.name || parsed.feed.title || channelId,
        url: `https://www.youtube.com/channel/${channelId}`,
      };
    } catch (error) {
      logger.error(`Error fetching channel info for ${channelId}:`, error);
      return null;
    }
  }

  /**
   * Resolve channel ID from a YouTube handle using multiple methods
   */
  private async resolveChannelFromPage(pageUrl: string): Promise<YouTubeChannelInfo | null> {
    // Method 1: Try fetching the page directly with a browser-like user agent
    try {
      const response = await fetch(pageUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
        },
        redirect: 'follow',
      });

      if (!response.ok) {
        logger.warn(`Failed to fetch ${pageUrl}: ${response.status}`);
        return null;
      }

      const html = await response.text();

      // Look for channel ID in the page - must start with UC and be 24 chars
      // Try multiple patterns as YouTube's page structure varies

      // Pattern 1: "channelId":"UC..." in JSON data
      const channelIdMatch = html.match(/"channelId"\s*:\s*"(UC[a-zA-Z0-9_-]{22})"/);
      if (channelIdMatch && channelIdMatch[1]) {
        logger.debug(`Found channel ID via channelId pattern: ${channelIdMatch[1]}`);
        return this.getChannelInfo(channelIdMatch[1]);
      }

      // Pattern 2: "externalId":"UC..."
      const externalIdMatch = html.match(/"externalId"\s*:\s*"(UC[a-zA-Z0-9_-]{22})"/);
      if (externalIdMatch && externalIdMatch[1]) {
        logger.debug(`Found channel ID via externalId pattern: ${externalIdMatch[1]}`);
        return this.getChannelInfo(externalIdMatch[1]);
      }

      // Pattern 3: "browseId":"UC..."
      const browseIdMatch = html.match(/"browseId"\s*:\s*"(UC[a-zA-Z0-9_-]{22})"/);
      if (browseIdMatch && browseIdMatch[1]) {
        logger.debug(`Found channel ID via browseId pattern: ${browseIdMatch[1]}`);
        return this.getChannelInfo(browseIdMatch[1]);
      }

      // Pattern 4: canonical URL in meta tag
      const canonicalMatch = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']https:\/\/www\.youtube\.com\/channel\/(UC[a-zA-Z0-9_-]{22})["']/);
      if (canonicalMatch && canonicalMatch[1]) {
        logger.debug(`Found channel ID via canonical URL: ${canonicalMatch[1]}`);
        return this.getChannelInfo(canonicalMatch[1]);
      }

      // Pattern 5: og:url meta tag
      const ogUrlMatch = html.match(/<meta[^>]+property=["']og:url["'][^>]+content=["']https:\/\/www\.youtube\.com\/channel\/(UC[a-zA-Z0-9_-]{22})["']/);
      if (ogUrlMatch && ogUrlMatch[1]) {
        logger.debug(`Found channel ID via og:url: ${ogUrlMatch[1]}`);
        return this.getChannelInfo(ogUrlMatch[1]);
      }

      // Pattern 6: itemprop="channelId"
      const itemPropMatch = html.match(/itemprop=["']channelId["'][^>]*content=["'](UC[a-zA-Z0-9_-]{22})["']/);
      if (itemPropMatch && itemPropMatch[1]) {
        logger.debug(`Found channel ID via itemprop: ${itemPropMatch[1]}`);
        return this.getChannelInfo(itemPropMatch[1]);
      }

      // Pattern 7: /channel/UC... anywhere in the page (last resort)
      const channelUrlMatch = html.match(/\/channel\/(UC[a-zA-Z0-9_-]{22})/);
      if (channelUrlMatch && channelUrlMatch[1]) {
        logger.debug(`Found channel ID via URL pattern: ${channelUrlMatch[1]}`);
        return this.getChannelInfo(channelUrlMatch[1]);
      }

      logger.warn(`Could not find channel ID in page: ${pageUrl}`);
      return null;
    } catch (error) {
      logger.error(`Error resolving channel from page ${pageUrl}:`, error);
      return null;
    }
  }

  /**
   * Fetch latest videos from a YouTube channel
   */
  async fetchVideos(channelId: string, maxItems: number = 15): Promise<FeedItem[]> {
    try {
      const response = await fetch(`${YOUTUBE_RSS_URL}${channelId}`);

      if (!response.ok) {
        logger.warn(`Failed to fetch YouTube feed for ${channelId}: ${response.status}`);
        return [];
      }

      const xml = await response.text();
      const parsed = this.parser.parse(xml) as YouTubeRssFeed;

      if (!parsed.feed?.entry) {
        logger.debug(`No entries in YouTube feed for ${channelId}`);
        return [];
      }

      // Normalize to array
      const entries = Array.isArray(parsed.feed.entry)
        ? parsed.feed.entry
        : [parsed.feed.entry];

      const items: FeedItem[] = entries.slice(0, maxItems).map((entry) => ({
        id: entry['yt:videoId'],
        title: entry.title,
        url: entry.link?.['@_href'] || `https://www.youtube.com/watch?v=${entry['yt:videoId']}`,
        publishedAt: new Date(entry.published),
        author: entry.author?.name,
        thumbnail: entry['media:group']?.['media:thumbnail']?.['@_url'],
      }));

      logger.debug(`Fetched ${items.length} videos from YouTube channel ${channelId}`);
      return items;
    } catch (error) {
      logger.error(`Error fetching YouTube videos for ${channelId}:`, error);
      return [];
    }
  }

  /**
   * Validate that a channel ID is valid by attempting to fetch its feed
   */
  async validateChannel(channelId: string): Promise<boolean> {
    const info = await this.getChannelInfo(channelId);
    return info !== null;
  }
}

// Export singleton
export const youtubeFetcher = new YouTubeFetcher();
