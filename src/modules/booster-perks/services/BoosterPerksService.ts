import { Guild, GuildMember } from 'discord.js';
import { DatabaseService, RowDataPacket } from '../../../core/database/postgres.js';
import { Logger } from '../../../shared/utils/logger.js';
import { randomUUID } from 'crypto';
import { spawn } from 'child_process';

const logger = new Logger('BoosterPerks:Service');

export type AssetType = 'sound' | 'emoji';

export interface BoosterAsset {
  id: string;
  guild_id: string;
  user_id: string;
  asset_type: AssetType;
  asset_id: string;
  asset_name: string;
  original_url: string | null;
  created_at: Date;
}

const ALLOWED_SOUND_EXTENSIONS = ['.mp3', '.wav', '.ogg', '.m4a'];
const ALLOWED_EMOJI_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];
const MAX_SOUND_SIZE = 512 * 1024; // 512KB - Discord soundboard limit
const MAX_EMOJI_SIZE = 256 * 1024; // 256KB - Discord emoji limit

export class BoosterPerksService {
  constructor(private db: DatabaseService) {}

  // ==================== Booster Check ====================

  isBooster(member: GuildMember): boolean {
    return member.premiumSince !== null;
  }

  // ==================== Generic Asset CRUD ====================

  async getUserAssets(guildId: string, userId: string, type: AssetType): Promise<BoosterAsset[]> {
    return this.db.query<(BoosterAsset & RowDataPacket)[]>(
      'SELECT * FROM boosterperks_assets WHERE guild_id = ? AND user_id = ? AND asset_type = ? ORDER BY created_at ASC',
      [guildId, userId, type]
    );
  }

  async getGuildAssets(guildId: string, type: AssetType): Promise<BoosterAsset[]> {
    return this.db.query<(BoosterAsset & RowDataPacket)[]>(
      'SELECT * FROM boosterperks_assets WHERE guild_id = ? AND asset_type = ? ORDER BY user_id ASC, created_at ASC',
      [guildId, type]
    );
  }

  async getUserAssetCount(guildId: string, userId: string, type: AssetType): Promise<number> {
    const rows = await this.db.query<({ count: number } & RowDataPacket)[]>(
      'SELECT COUNT(*) as count FROM boosterperks_assets WHERE guild_id = ? AND user_id = ? AND asset_type = ?',
      [guildId, userId, type]
    );
    return rows[0]?.count ?? 0;
  }

  async getAssetById(id: string): Promise<BoosterAsset | null> {
    const rows = await this.db.query<(BoosterAsset & RowDataPacket)[]>(
      'SELECT * FROM boosterperks_assets WHERE id = ?',
      [id]
    );
    return rows[0] || null;
  }

  async trackAsset(
    guildId: string,
    userId: string,
    type: AssetType,
    assetId: string,
    assetName: string,
    originalUrl: string | null,
  ): Promise<BoosterAsset> {
    const id = randomUUID();
    await this.db.execute(
      'INSERT INTO boosterperks_assets (id, guild_id, user_id, asset_type, asset_id, asset_name, original_url) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, guildId, userId, type, assetId, assetName, originalUrl]
    );

    logger.info(`Tracked ${type} "${assetName}" (${assetId}) for user ${userId} in guild ${guildId}`);
    return {
      id,
      guild_id: guildId,
      user_id: userId,
      asset_type: type,
      asset_id: assetId,
      asset_name: assetName,
      original_url: originalUrl,
      created_at: new Date(),
    };
  }

  async removeAsset(id: string): Promise<boolean> {
    const result = await this.db.execute(
      'DELETE FROM boosterperks_assets WHERE id = ?',
      [id]
    );
    return (result as { affectedRows: number }).affectedRows > 0;
  }

  async removeAllUserAssets(guildId: string, userId: string, type?: AssetType): Promise<number> {
    const query = type
      ? 'DELETE FROM boosterperks_assets WHERE guild_id = ? AND user_id = ? AND asset_type = ?'
      : 'DELETE FROM boosterperks_assets WHERE guild_id = ? AND user_id = ?';
    const params = type ? [guildId, userId, type] : [guildId, userId];

    const result = await this.db.execute(query, params);
    return (result as { affectedRows: number }).affectedRows;
  }

  // ==================== File Download ====================

  async downloadFile(url: string, type: AssetType): Promise<Buffer> {
    const allowedExtensions = type === 'sound' ? ALLOWED_SOUND_EXTENSIONS : ALLOWED_EMOJI_EXTENSIONS;
    const maxSize = type === 'sound' ? MAX_SOUND_SIZE : MAX_EMOJI_SIZE;

    // Validate URL has a scheme/host before handing to fetch
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      throw new Error('Invalid URL. Paste a full link starting with https://');
    }
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      throw new Error('URL must use http:// or https://');
    }

    // Validate URL extension
    const urlLower = (url.toLowerCase().split('?')[0] ?? '');
    const hasValidExtension = allowedExtensions.some(ext => urlLower.endsWith(ext));
    if (!hasValidExtension) {
      throw new Error(`Invalid file type. Allowed: ${allowedExtensions.join(', ')}`);
    }

    const response = await fetch(url, {
      headers: { 'User-Agent': 'QuadsLabBot/1.0' },
    });

    if (!response.ok) {
      throw new Error(`Failed to download file: HTTP ${response.status}`);
    }

    const contentLength = response.headers.get('content-length');
    if (contentLength && parseInt(contentLength) > maxSize) {
      throw new Error(`File too large. Maximum size: ${maxSize / 1024}KB`);
    }

    const arrayBuffer = await response.arrayBuffer();
    let buffer: Buffer = Buffer.from(arrayBuffer);

    if (buffer.length === 0) {
      throw new Error('Downloaded file is empty');
    }

    // Discord soundboard rejects audio/mp4 — transcode M4A to MP3 before upload
    if (type === 'sound' && urlLower.endsWith('.m4a')) {
      buffer = await transcodeToMp3(buffer);
    }

    if (buffer.length > maxSize) {
      throw new Error(`File too large (${Math.round(buffer.length / 1024)}KB). Maximum: ${maxSize / 1024}KB`);
    }

    return buffer;
  }

  // ==================== Soundboard Operations ====================

  async createSoundboardSound(
    guild: Guild,
    name: string,
    soundBuffer: Buffer,
    volume?: number,
  ): Promise<string> {
    // Determine content type from magic bytes
    let contentType = 'audio/ogg';
    if (soundBuffer[0] === 0x49 && soundBuffer[1] === 0x44 && soundBuffer[2] === 0x33) {
      contentType = 'audio/mpeg'; // MP3 with ID3 tag
    } else if (soundBuffer[0] === 0xFF && (soundBuffer[1]! & 0xE0) === 0xE0) {
      contentType = 'audio/mpeg'; // MP3 sync frame
    } else if (soundBuffer[0] === 0x52 && soundBuffer[1] === 0x49 && soundBuffer[2] === 0x46 && soundBuffer[3] === 0x46) {
      contentType = 'audio/wav'; // RIFF/WAV
    } else if (soundBuffer[4] === 0x66 && soundBuffer[5] === 0x74 && soundBuffer[6] === 0x79 && soundBuffer[7] === 0x70) {
      contentType = 'audio/mp4'; // ISO BMFF "ftyp" box — M4A/MP4 audio
    }

    const sound = await guild.soundboardSounds.create({
      name,
      file: soundBuffer,
      contentType,
      volume: volume ?? 1.0,
    });

    logger.info(`Created soundboard sound "${name}" (${sound.soundId}) in guild ${guild.id}`);
    return sound.soundId;
  }

  async deleteSoundboardSound(guild: Guild, soundId: string): Promise<void> {
    await guild.soundboardSounds.delete(soundId);
    logger.info(`Deleted soundboard sound ${soundId} from guild ${guild.id}`);
  }

  // ==================== Emoji Operations ====================

  async createCustomEmoji(
    guild: Guild,
    name: string,
    imageBuffer: Buffer,
  ): Promise<string> {
    const emoji = await guild.emojis.create({
      attachment: imageBuffer,
      name,
    });

    logger.info(`Created emoji "${name}" (${emoji.id}) in guild ${guild.id}`);
    return emoji.id;
  }

  async deleteCustomEmoji(guild: Guild, emojiId: string): Promise<void> {
    await guild.emojis.delete(emojiId);
    logger.info(`Deleted emoji ${emojiId} from guild ${guild.id}`);
  }
}

function transcodeToMp3(input: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', [
      '-loglevel', 'error',
      '-i', 'pipe:0',
      '-vn',
      '-f', 'mp3',
      '-b:a', '128k',
      'pipe:1',
    ], { stdio: ['pipe', 'pipe', 'pipe'] });

    const stdoutChunks: Buffer[] = [];
    let stderrText = '';

    ff.stdout.on('data', (c: Buffer) => stdoutChunks.push(c));
    ff.stderr.on('data', (c: Buffer) => { stderrText += c.toString(); });
    ff.on('error', (err) => reject(new Error(`ffmpeg failed to start: ${err.message}`)));
    ff.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg exited ${code}: ${stderrText.trim().slice(0, 300)}`));
        return;
      }
      resolve(Buffer.concat(stdoutChunks));
    });

    ff.stdin.on('error', () => { /* ignored — surfaced via close */ });
    ff.stdin.end(input);
  });
}
