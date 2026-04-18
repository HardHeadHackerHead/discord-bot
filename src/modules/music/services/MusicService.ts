import { randomUUID } from 'crypto';
import type { DatabaseService, RowDataPacket } from '../../../core/database/postgres.js';
import type { ModuleEventBus } from '../../../core/modules/ModuleEventBus.js';
import { Logger } from '../../../shared/utils/logger.js';
import { MODULE_EVENTS } from '../../../types/module-events.types.js';
import type { StreamTrack } from './StreamingClient.js';

const logger = new Logger('MusicService');

// ==================== Database Row Types ====================

export interface MusicTrackRow {
  id: string;
  external_id: string;
  provider: string;
  title: string;
  artist: string;
  album: string | null;
  duration: number;
  artwork_url: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface MusicPlaylistRow {
  id: string;
  user_id: string;
  guild_id: string;
  name: string;
  is_public: boolean;
  track_count: number;
  created_at: Date;
  updated_at: Date;
}

export interface MusicPlaylistTrackRow {
  id: string;
  playlist_id: string;
  track_id: string;
  position: number;
  added_at: Date;
}

export interface MusicLikeRow {
  id: string;
  user_id: string;
  guild_id: string;
  track_id: string;
  created_at: Date;
}

export interface MusicPlayCountRow {
  id: string;
  track_id: string;
  guild_id: string;
  play_count: number;
  total_listen_seconds: number;
  last_played_at: Date;
}

export interface MusicUserStatsRow {
  id: string;
  user_id: string;
  guild_id: string;
  total_tracks_played: number;
  total_listen_seconds: number;
  total_likes: number;
  created_at: Date;
  updated_at: Date;
}

/**
 * MusicService handles all database operations for the music module:
 * track caching, playlists, likes, play counts, and user stats.
 */
export class MusicService {
  private moduleId = 'music';

  constructor(
    private db: DatabaseService,
    private eventBus: ModuleEventBus
  ) {}

  // ==================== Track Operations ====================

  /**
   * Get or create a cached track from streaming provider metadata
   */
  async getOrCreateTrack(streamTrack: StreamTrack, provider: string = 'default'): Promise<MusicTrackRow> {
    // Check if track already cached
    const existing = await this.db.query<(MusicTrackRow & RowDataPacket)[]>(
      'SELECT * FROM music_tracks WHERE external_id = ? AND provider = ?',
      [streamTrack.id, provider]
    );

    if (existing[0]) {
      // Update metadata if changed
      await this.db.execute(
        `UPDATE music_tracks SET title = ?, artist = ?, album = ?, duration = ?, artwork_url = ?
         WHERE id = ?`,
        [streamTrack.title, streamTrack.artist, streamTrack.album, streamTrack.duration, streamTrack.artwork_url, existing[0].id]
      );
      return { ...existing[0], ...streamTrack, album: streamTrack.album };
    }

    const id = randomUUID();
    await this.db.execute(
      `INSERT INTO music_tracks (id, external_id, provider, title, artist, album, duration, artwork_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, streamTrack.id, provider, streamTrack.title, streamTrack.artist, streamTrack.album, streamTrack.duration, streamTrack.artwork_url]
    );

    return {
      id,
      external_id: streamTrack.id,
      provider,
      title: streamTrack.title,
      artist: streamTrack.artist,
      album: streamTrack.album,
      duration: streamTrack.duration,
      artwork_url: streamTrack.artwork_url,
      created_at: new Date(),
      updated_at: new Date(),
    };
  }

  /**
   * Get a track by internal ID
   */
  async getTrackById(trackId: string): Promise<MusicTrackRow | null> {
    const rows = await this.db.query<(MusicTrackRow & RowDataPacket)[]>(
      'SELECT * FROM music_tracks WHERE id = ?',
      [trackId]
    );
    return rows[0] || null;
  }

  // ==================== Playlist Operations ====================

  /**
   * Create a new playlist
   */
  async createPlaylist(userId: string, guildId: string, name: string, isPublic: boolean = true): Promise<MusicPlaylistRow> {
    const id = randomUUID();
    await this.db.execute(
      `INSERT INTO music_playlists (id, user_id, guild_id, name, is_public)
       VALUES (?, ?, ?, ?, ?)`,
      [id, userId, guildId, name, isPublic]
    );

    return {
      id,
      user_id: userId,
      guild_id: guildId,
      name,
      is_public: isPublic,
      track_count: 0,
      created_at: new Date(),
      updated_at: new Date(),
    };
  }

  /**
   * Delete a playlist (creator only)
   */
  async deletePlaylist(playlistId: string, userId: string): Promise<boolean> {
    const result = await this.db.execute(
      'DELETE FROM music_playlists WHERE id = ? AND user_id = ?',
      [playlistId, userId]
    );
    return result.affectedRows > 0;
  }

  /**
   * Get a playlist by name for a user in a guild
   */
  async getPlaylistByName(userId: string, guildId: string, name: string): Promise<MusicPlaylistRow | null> {
    const rows = await this.db.query<(MusicPlaylistRow & RowDataPacket)[]>(
      'SELECT * FROM music_playlists WHERE user_id = ? AND guild_id = ? AND name = ?',
      [userId, guildId, name]
    );
    return rows[0] || null;
  }

  /**
   * Get a playlist by ID
   */
  async getPlaylistById(playlistId: string): Promise<MusicPlaylistRow | null> {
    const rows = await this.db.query<(MusicPlaylistRow & RowDataPacket)[]>(
      'SELECT * FROM music_playlists WHERE id = ?',
      [playlistId]
    );
    return rows[0] || null;
  }

  /**
   * Find a playlist by name in a guild (checks user's own first, then public)
   */
  async findPlaylist(guildId: string, name: string, userId?: string): Promise<MusicPlaylistRow | null> {
    // Try user's own playlist first
    if (userId) {
      const own = await this.getPlaylistByName(userId, guildId, name);
      if (own) return own;
    }

    // Try any public playlist with that name
    const rows = await this.db.query<(MusicPlaylistRow & RowDataPacket)[]>(
      'SELECT * FROM music_playlists WHERE guild_id = ? AND name = ? AND is_public = TRUE LIMIT 1',
      [guildId, name]
    );
    return rows[0] || null;
  }

  /**
   * List playlists for a user in a guild
   */
  async listPlaylists(userId: string, guildId: string): Promise<MusicPlaylistRow[]> {
    return this.db.query<(MusicPlaylistRow & RowDataPacket)[]>(
      'SELECT * FROM music_playlists WHERE user_id = ? AND guild_id = ? ORDER BY name',
      [userId, guildId]
    );
  }

  /**
   * List public playlists for a user in a guild (for viewing another user's playlists)
   */
  async listPublicPlaylists(userId: string, guildId: string): Promise<MusicPlaylistRow[]> {
    return this.db.query<(MusicPlaylistRow & RowDataPacket)[]>(
      'SELECT * FROM music_playlists WHERE user_id = ? AND guild_id = ? AND is_public = TRUE ORDER BY name',
      [userId, guildId]
    );
  }

  /**
   * Get all playlist names for autocomplete
   */
  async getPlaylistNames(guildId: string, userId: string): Promise<string[]> {
    const rows = await this.db.query<({ name: string } & RowDataPacket)[]>(
      `SELECT DISTINCT name FROM music_playlists
       WHERE guild_id = ? AND (user_id = ? OR is_public = TRUE)
       ORDER BY name LIMIT 25`,
      [guildId, userId]
    );
    return rows.map((r) => r.name);
  }

  /**
   * Add a track to a playlist
   */
  async addTrackToPlaylist(playlistId: string, trackId: string, maxPlaylistSize: number = 200): Promise<boolean> {
    // Get current track count
    const playlist = await this.getPlaylistById(playlistId);
    if (!playlist) return false;
    if (playlist.track_count >= maxPlaylistSize) return false;

    // Check if track already in playlist
    const existing = await this.db.query<(MusicPlaylistTrackRow & RowDataPacket)[]>(
      'SELECT id FROM music_playlist_tracks WHERE playlist_id = ? AND track_id = ?',
      [playlistId, trackId]
    );
    if (existing[0]) return false;

    const id = randomUUID();
    const position = playlist.track_count + 1;

    await this.db.execute(
      `INSERT INTO music_playlist_tracks (id, playlist_id, track_id, position)
       VALUES (?, ?, ?, ?)`,
      [id, playlistId, trackId, position]
    );

    await this.db.execute(
      'UPDATE music_playlists SET track_count = track_count + 1 WHERE id = ?',
      [playlistId]
    );

    return true;
  }

  /**
   * Remove a track from a playlist by position
   */
  async removeTrackFromPlaylist(playlistId: string, position: number): Promise<boolean> {
    const rows = await this.db.query<(MusicPlaylistTrackRow & RowDataPacket)[]>(
      'SELECT id FROM music_playlist_tracks WHERE playlist_id = ? AND position = ?',
      [playlistId, position]
    );
    if (!rows[0]) return false;

    await this.db.execute(
      'DELETE FROM music_playlist_tracks WHERE id = ?',
      [rows[0].id]
    );

    // Reorder remaining tracks
    await this.db.execute(
      'UPDATE music_playlist_tracks SET position = position - 1 WHERE playlist_id = ? AND position > ?',
      [playlistId, position]
    );

    await this.db.execute(
      'UPDATE music_playlists SET track_count = track_count - 1 WHERE id = ? AND track_count > 0',
      [playlistId]
    );

    return true;
  }

  /**
   * Get tracks in a playlist ordered by position
   */
  async getPlaylistTracks(playlistId: string): Promise<(MusicPlaylistTrackRow & MusicTrackRow)[]> {
    return this.db.query<((MusicPlaylistTrackRow & MusicTrackRow) & RowDataPacket)[]>(
      `SELECT pt.*, t.external_id, t.provider, t.title, t.artist, t.album, t.duration, t.artwork_url
       FROM music_playlist_tracks pt
       JOIN music_tracks t ON pt.track_id = t.id
       WHERE pt.playlist_id = ?
       ORDER BY pt.position`,
      [playlistId]
    );
  }

  // ==================== Like Operations ====================

  /**
   * Toggle a like on a track. Returns the new like state.
   */
  async toggleLike(userId: string, guildId: string, trackId: string): Promise<boolean> {
    const existing = await this.db.query<(MusicLikeRow & RowDataPacket)[]>(
      'SELECT id FROM music_likes WHERE user_id = ? AND guild_id = ? AND track_id = ?',
      [userId, guildId, trackId]
    );

    if (existing[0]) {
      // Unlike
      await this.db.execute('DELETE FROM music_likes WHERE id = ?', [existing[0].id]);
      await this.updateUserStats(userId, guildId, { total_likes_delta: -1 });

      const track = await this.getTrackById(trackId);
      this.eventBus.emitAsync(MODULE_EVENTS.MUSIC_TRACK_LIKED, this.moduleId, {
        trackId,
        title: track?.title || 'Unknown',
        userId,
        guildId,
        liked: false,
      });

      return false;
    } else {
      // Like
      const id = randomUUID();
      await this.db.execute(
        'INSERT INTO music_likes (id, user_id, guild_id, track_id) VALUES (?, ?, ?, ?)',
        [id, userId, guildId, trackId]
      );
      await this.updateUserStats(userId, guildId, { total_likes_delta: 1 });

      const track = await this.getTrackById(trackId);
      this.eventBus.emitAsync(MODULE_EVENTS.MUSIC_TRACK_LIKED, this.moduleId, {
        trackId,
        title: track?.title || 'Unknown',
        userId,
        guildId,
        liked: true,
      });

      return true;
    }
  }

  /**
   * Get the like count for a track in a guild
   */
  async getLikeCount(trackId: string, guildId: string): Promise<number> {
    const rows = await this.db.query<({ count: number } & RowDataPacket)[]>(
      'SELECT COUNT(*) as count FROM music_likes WHERE track_id = ? AND guild_id = ?',
      [trackId, guildId]
    );
    return rows[0]?.count ?? 0;
  }

  /**
   * Check if a user has liked a track
   */
  async hasLiked(userId: string, guildId: string, trackId: string): Promise<boolean> {
    const rows = await this.db.query<(MusicLikeRow & RowDataPacket)[]>(
      'SELECT id FROM music_likes WHERE user_id = ? AND guild_id = ? AND track_id = ?',
      [userId, guildId, trackId]
    );
    return Boolean(rows[0]);
  }

  // ==================== Play History & Stats ====================

  /**
   * Record a play event
   */
  async recordPlay(
    trackId: string,
    guildId: string,
    userId: string,
    channelId: string
  ): Promise<void> {
    const historyId = randomUUID();
    await this.db.execute(
      `INSERT INTO music_play_history (id, track_id, guild_id, user_id, channel_id)
       VALUES (?, ?, ?, ?, ?)`,
      [historyId, trackId, guildId, userId, channelId]
    );

    // Update or create play count
    await this.db.execute(
      `INSERT INTO music_play_counts (id, track_id, guild_id, play_count, last_played_at)
       VALUES (?, ?, ?, 1, NOW())
       ON CONFLICT (track_id, guild_id) DO UPDATE SET play_count = music_play_counts.play_count + 1, last_played_at = NOW()`,
      [randomUUID(), trackId, guildId]
    );

    // Update user stats
    await this.updateUserStats(userId, guildId, { total_tracks_played_delta: 1 });

    // Emit event
    const track = await this.getTrackById(trackId);
    if (track) {
      this.eventBus.emitAsync(MODULE_EVENTS.MUSIC_TRACK_PLAYED, this.moduleId, {
        trackId,
        title: track.title,
        artist: track.artist,
        guildId,
        userId,
      });
    }
  }

  /**
   * Update listen duration for a play event
   */
  async updateListenDuration(
    trackId: string,
    guildId: string,
    userId: string,
    durationSeconds: number,
    completed: boolean
  ): Promise<void> {
    // Update the most recent history entry
    await this.db.execute(
      `UPDATE music_play_history
       SET duration_listened = ?, completed = ?
       WHERE track_id = ? AND guild_id = ? AND user_id = ?
       ORDER BY created_at DESC LIMIT 1`,
      [durationSeconds, completed, trackId, guildId, userId]
    );

    // Update play count total listen seconds
    await this.db.execute(
      `UPDATE music_play_counts
       SET total_listen_seconds = total_listen_seconds + ?
       WHERE track_id = ? AND guild_id = ?`,
      [durationSeconds, trackId, guildId]
    );

    // Update user stats
    await this.updateUserStats(userId, guildId, { total_listen_seconds_delta: durationSeconds });
  }

  /**
   * Get play count for a track in a guild
   */
  async getPlayCount(trackId: string, guildId: string): Promise<number> {
    const rows = await this.db.query<(MusicPlayCountRow & RowDataPacket)[]>(
      'SELECT play_count FROM music_play_counts WHERE track_id = ? AND guild_id = ?',
      [trackId, guildId]
    );
    return rows[0]?.play_count ?? 0;
  }

  // ==================== User Stats ====================

  /**
   * Get or create user stats
   */
  async getOrCreateUserStats(userId: string, guildId: string): Promise<MusicUserStatsRow> {
    const rows = await this.db.query<(MusicUserStatsRow & RowDataPacket)[]>(
      'SELECT * FROM music_user_stats WHERE user_id = ? AND guild_id = ?',
      [userId, guildId]
    );

    if (rows[0]) return rows[0];

    const id = randomUUID();
    await this.db.execute(
      'INSERT INTO music_user_stats (id, user_id, guild_id) VALUES (?, ?, ?)',
      [id, userId, guildId]
    );

    return {
      id,
      user_id: userId,
      guild_id: guildId,
      total_tracks_played: 0,
      total_listen_seconds: 0,
      total_likes: 0,
      created_at: new Date(),
      updated_at: new Date(),
    };
  }

  /**
   * Update user stats with deltas
   */
  private async updateUserStats(
    userId: string,
    guildId: string,
    deltas: {
      total_tracks_played_delta?: number;
      total_listen_seconds_delta?: number;
      total_likes_delta?: number;
    }
  ): Promise<void> {
    await this.getOrCreateUserStats(userId, guildId);

    const setClauses: string[] = [];
    const params: unknown[] = [];

    if (deltas.total_tracks_played_delta) {
      setClauses.push('total_tracks_played = total_tracks_played + ?');
      params.push(deltas.total_tracks_played_delta);
    }
    if (deltas.total_listen_seconds_delta) {
      setClauses.push('total_listen_seconds = total_listen_seconds + ?');
      params.push(deltas.total_listen_seconds_delta);
    }
    if (deltas.total_likes_delta) {
      setClauses.push('total_likes = GREATEST(0, total_likes + ?)');
      params.push(deltas.total_likes_delta);
    }

    if (setClauses.length === 0) return;

    params.push(userId, guildId);
    await this.db.execute(
      `UPDATE music_user_stats SET ${setClauses.join(', ')} WHERE user_id = ? AND guild_id = ?`,
      params
    );
  }

  // ==================== Leaderboard ====================

  /**
   * Get leaderboard entries by listen time
   */
  async getLeaderboard(guildId: string, limit: number = 10, offset: number = 0): Promise<MusicUserStatsRow[]> {
    const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
    const safeOffset = Math.max(0, Math.floor(offset));
    return this.db.query<(MusicUserStatsRow & RowDataPacket)[]>(
      `SELECT * FROM music_user_stats
       WHERE guild_id = ? AND total_listen_seconds > 0
       ORDER BY total_listen_seconds DESC
       LIMIT ${safeLimit} OFFSET ${safeOffset}`,
      [guildId]
    );
  }

  /**
   * Get a user's rank by listen time
   */
  async getUserRank(userId: string, guildId: string): Promise<number> {
    const result = await this.db.query<({ user_rank: number } & RowDataPacket)[]>(
      `SELECT COUNT(*) + 1 as user_rank
       FROM music_user_stats
       WHERE guild_id = ? AND total_listen_seconds > (
         SELECT COALESCE(total_listen_seconds, 0) FROM music_user_stats
         WHERE user_id = ? AND guild_id = ?
       )`,
      [guildId, userId, guildId]
    );
    return result[0]?.user_rank ?? 0;
  }

  /**
   * Get total users with listen time in a guild
   */
  async getTotalListeners(guildId: string): Promise<number> {
    const result = await this.db.query<({ count: number } & RowDataPacket)[]>(
      'SELECT COUNT(*) as count FROM music_user_stats WHERE guild_id = ? AND total_listen_seconds > 0',
      [guildId]
    );
    return result[0]?.count ?? 0;
  }
}
