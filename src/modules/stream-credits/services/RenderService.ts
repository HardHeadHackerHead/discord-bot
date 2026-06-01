import { spawn } from 'child_process';
import { writeFile, unlink, mkdir, stat } from 'fs/promises';
import { existsSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { Logger } from '../../../shared/utils/logger.js';
import type { CreditsData } from './CreditsService.js';
import type { GrowthStats } from './GrowthDataService.js';
import type { ActivityStats } from './ActivityStatsService.js';
import type { YouTubeData } from './YouTubeService.js';

const logger = new Logger('StreamCredits:Render');

export interface NewMemberData {
  userId: string;
  displayName: string;
  avatarUrl: string;
  joinedAt: string;
}

export interface RenderOptions {
  data: CreditsData;
  growthData: GrowthStats;
  guildId: string;
  activityStats?: ActivityStats;
  youtubeData?: YouTubeData | null;
  newMembers?: NewMemberData[];
  onProgress?: (percent: number) => void;
}

export interface RenderResult {
  filePath: string;
  fileSize: number;
  durationSec: number;
  memberCount: number;
}

export class RenderService {
  private activeRenders = new Set<string>();
  private creditsVideoDir: string;
  private tempDir: string;

  constructor() {
    // Resolve credits-video directory: check Docker path first, fall back to source tree
    const dockerPath = resolve('/app/credits-video');
    const srcPath = resolve('src/modules/stream-credits/credits-video');
    this.creditsVideoDir = existsSync(dockerPath) ? dockerPath : srcPath;
    // Use OS temp dir to avoid spaces in path breaking Remotion CLI on Windows
    this.tempDir = join(tmpdir(), 'credits-render');
  }

  isRendering(guildId: string): boolean {
    return this.activeRenders.has(guildId);
  }

  async render(options: RenderOptions): Promise<RenderResult> {
    const { data, growthData, guildId, activityStats, youtubeData, newMembers, onProgress } = options;

    if (this.activeRenders.has(guildId)) {
      throw new Error('A render is already in progress for this server.');
    }

    this.activeRenders.add(guildId);
    const propsPath = join(this.tempDir, `props-${guildId}.json`);
    const outputPath = join(this.tempDir, `credits-${guildId}.mp4`);

    try {
      await mkdir(this.tempDir, { recursive: true });

      const mapMember = (m: CreditsData['boosters'][number]) => ({
        userId: m.userId,
        username: m.username,
        displayName: m.displayName,
        avatarUrl: m.avatarUrl,
        isBooster: m.isBooster,
        isTagWearer: m.isTagWearer,
        serverTag: m.serverTag,
      });

      // Build props for Remotion
      const props: Record<string, unknown> = {
        guildName: data.guildName,
        guildIconUrl: data.guildIconUrl,
        boosters: data.boosters.map(mapMember),
        tagWearers: data.tagWearers.map(mapMember),
        allMembers: data.allMembers.map(mapMember),
        growthData,
      };

      if (activityStats) {
        props['activityStats'] = activityStats;
      }

      if (youtubeData) {
        // Download YouTube thumbnails to local files so Remotion can load them
        const localYt = await this.localizeYouTubeData(youtubeData, guildId);
        props['youtubeData'] = localYt;
      }

      if (newMembers && newMembers.length > 0) {
        props['newMembers'] = newMembers;
      }

      await writeFile(propsPath, JSON.stringify(props, null, 2), 'utf-8');
      logger.info(`Props written to ${propsPath}`);

      // Spawn Remotion render
      await this.spawnRender(propsPath, outputPath, onProgress);

      // Get file size
      const stats = await stat(outputPath);

      // We let Remotion calculate the duration via calculateMetadata (audio-based),
      // so just estimate from audio length (~152.76s) or fallback
      const estimatedDurationSec = 152.76;

      return {
        filePath: outputPath,
        fileSize: stats.size,
        durationSec: estimatedDurationSec,
        memberCount: data.allMembers.length,
      };
    } finally {
      this.activeRenders.delete(guildId);

      // Clean up temp props file
      try {
        await unlink(propsPath);
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  /**
   * Download YouTube thumbnails and inline them as base64 data URLs so
   * Remotion's headless Chromium can render them without hitting the
   * "Not allowed to load local resource" file:// restriction.
   */
  private async localizeYouTubeData(
    ytData: YouTubeData,
    _guildId: string
  ): Promise<YouTubeData> {
    const localized: YouTubeData = {
      channel: { ...ytData.channel },
      recentVideos: ytData.recentVideos.map((v) => ({ ...v })),
    };

    if (localized.channel.channelThumbnail) {
      const dataUrl = await this.fetchImageAsDataUrl(localized.channel.channelThumbnail);
      localized.channel.channelThumbnail = dataUrl;
    }

    for (let i = 0; i < localized.recentVideos.length; i++) {
      const video = localized.recentVideos[i]!;
      if (video.thumbnailUrl) {
        const dataUrl = await this.fetchImageAsDataUrl(video.thumbnailUrl);
        video.thumbnailUrl = dataUrl;
      }
    }

    return localized;
  }

  private async fetchImageAsDataUrl(url: string): Promise<string | null> {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        logger.warn(`Failed to download image ${url}: ${res.status}`);
        return null;
      }
      const contentType = res.headers.get('content-type') || 'image/jpeg';
      const buf = Buffer.from(await res.arrayBuffer());
      return `data:${contentType};base64,${buf.toString('base64')}`;
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      logger.warn(`Failed to download image ${url}: ${msg}`);
      return null;
    }
  }

  private spawnRender(
    propsPath: string,
    outputPath: string,
    onProgress?: (percent: number) => void
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const args = [
        'remotion',
        'render',
        'src/Root.tsx',
        'CreditsVideo',
        `--props="${propsPath}"`,
        `--output="${outputPath}"`,
      ];

      logger.info(`Spawning: npx ${args.join(' ')}`);

      const proc = spawn('npx', args, {
        cwd: this.creditsVideoDir,
        shell: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stderr = '';

      proc.stdout.on('data', (data: Buffer) => {
        const line = data.toString();
        // Remotion outputs progress like "Rendered 50 out of 100 frames (50%)"
        const match = line.match(/\((\d+)%\)/);
        if (match && onProgress) {
          onProgress(parseInt(match[1]!, 10));
        }
      });

      proc.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        if (code === 0) {
          logger.info('Render completed successfully');
          resolve();
        } else {
          logger.error(`Render failed with code ${code}: ${stderr}`);
          reject(new Error(`Render failed (exit code ${code}): ${stderr.slice(0, 500)}`));
        }
      });

      proc.on('error', (error) => {
        logger.error(`Failed to spawn render process: ${error.message}`);
        reject(new Error(`Failed to spawn render process: ${error.message}`));
      });
    });
  }
}
