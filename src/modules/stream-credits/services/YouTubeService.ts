import { readFile } from 'fs/promises';
import { resolve } from 'path';
import { Logger } from '../../../shared/utils/logger.js';

const logger = new Logger('StreamCredits:YouTube');

export interface YouTubeChannelStats {
  channelName: string;
  subscriberCount: number;
  viewCount: number;
  videoCount: number;
  channelThumbnail: string | null;
}

export interface YouTubeVideoStats {
  title: string;
  viewCount: number;
  likeCount: number;
  publishedAt: string;
  thumbnailUrl: string | null;
}

export interface YouTubeData {
  channel: YouTubeChannelStats;
  recentVideos: YouTubeVideoStats[];
}

export class YouTubeService {
  private apiKey: string | null = null;

  async loadApiKey(): Promise<void> {
    const envKey = process.env['YOUTUBE_API_KEY'];
    if (envKey) {
      this.apiKey = envKey;
      logger.info('YouTube API key loaded from environment');
      return;
    }

    const candidates = [
      resolve('src/modules/stream-credits/youtube-key.json'),
      resolve('youtube-key.json'),
      new URL('../../stream-credits/youtube-key.json', import.meta.url).pathname,
    ];

    for (const keyPath of candidates) {
      try {
        const normalizedPath = keyPath.replace(/^\/([A-Z]:)/, '$1');
        const raw = await readFile(normalizedPath, 'utf-8');
        const data = JSON.parse(raw);
        this.apiKey = data.key;
        logger.info(`YouTube API key loaded from ${normalizedPath}`);
        return;
      } catch {
        // Try next candidate
      }
    }

    logger.warn('YouTube API key not found (set YOUTUBE_API_KEY env var) — YouTube stats will be skipped');
  }

  async fetchChannelData(channelId: string): Promise<YouTubeData | null> {
    if (!this.apiKey) return null;

    try {
      // Fetch channel stats
      const channelUrl = `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&id=${channelId}&key=${this.apiKey}`;
      const channelRes = await fetch(channelUrl);
      const channelJson = await channelRes.json() as any;

      if (!channelJson.items?.length) {
        logger.warn(`YouTube channel ${channelId} not found`);
        return null;
      }

      const ch = channelJson.items[0];
      const channel: YouTubeChannelStats = {
        channelName: ch.snippet.title,
        subscriberCount: parseInt(ch.statistics.subscriberCount ?? '0', 10),
        viewCount: parseInt(ch.statistics.viewCount ?? '0', 10),
        videoCount: parseInt(ch.statistics.videoCount ?? '0', 10),
        channelThumbnail: ch.snippet.thumbnails?.high?.url ?? null,
      };

      // Fetch recent videos
      const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${channelId}&order=date&maxResults=5&type=video&key=${this.apiKey}`;
      const searchRes = await fetch(searchUrl);
      const searchJson = await searchRes.json() as any;

      const videoIds = (searchJson.items ?? [])
        .map((v: any) => v.id.videoId)
        .filter(Boolean)
        .join(',');

      let recentVideos: YouTubeVideoStats[] = [];

      if (videoIds) {
        const videosUrl = `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&id=${videoIds}&key=${this.apiKey}`;
        const videosRes = await fetch(videosUrl);
        const videosJson = await videosRes.json() as any;

        recentVideos = (videosJson.items ?? []).map((v: any) => ({
          title: v.snippet.title,
          viewCount: parseInt(v.statistics.viewCount ?? '0', 10),
          likeCount: parseInt(v.statistics.likeCount ?? '0', 10),
          publishedAt: v.snippet.publishedAt,
          thumbnailUrl: v.snippet.thumbnails?.medium?.url ?? null,
        }));
      }

      logger.info(`YouTube data fetched: ${channel.channelName} (${channel.subscriberCount} subs)`);

      return { channel, recentVideos };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Failed to fetch YouTube data: ${msg}`);
      return null;
    }
  }
}
