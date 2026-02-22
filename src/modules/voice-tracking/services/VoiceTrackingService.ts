import { DatabaseService } from '../../../core/database/mysql.js';
import { ModuleEventBus } from '../../../core/modules/ModuleEventBus.js';
import { Logger } from '../../../shared/utils/logger.js';
import { RowDataPacket } from 'mysql2';
import { randomUUID } from 'crypto';
import {
  MODULE_EVENTS,
  VoiceSessionStartedEvent,
  VoiceSessionEndedEvent,
} from '../../../types/module-events.types.js';

const logger = new Logger('VoiceTracking:Service');

export interface VoiceSession {
  id: string;
  user_id: string;
  guild_id: string;
  channel_id: string;
  started_at: Date;
  ended_at: Date | null;
  duration_seconds: number | null;
  is_active: boolean;
}

export interface VoiceStats {
  id: string;
  user_id: string;
  guild_id: string;
  total_seconds: number;
  session_count: number;
  last_session_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export class VoiceTrackingService {
  private moduleId = 'voice-tracking';

  constructor(
    private db: DatabaseService,
    private eventBus: ModuleEventBus
  ) {}

  // ==================== Session Management ====================

  async startSession(
    userId: string,
    guildId: string,
    channelId: string
  ): Promise<VoiceSession> {
    // End any existing active session first (shouldn't happen, but safety)
    await this.endActiveSession(userId, guildId);

    const id = randomUUID();
    const startedAt = new Date();

    await this.db.execute(
      `INSERT INTO voicetime_sessions (id, user_id, guild_id, channel_id, started_at, is_active)
       VALUES (?, ?, ?, ?, ?, TRUE)`,
      [id, userId, guildId, channelId, startedAt]
    );

    logger.debug(`Started voice session for user ${userId} in channel ${channelId}`);

    // Emit session started event
    const eventData: VoiceSessionStartedEvent = {
      userId,
      guildId,
      channelId,
      startTime: startedAt,
    };
    this.eventBus.emitAsync(MODULE_EVENTS.VOICE_SESSION_STARTED, this.moduleId, eventData);

    return {
      id,
      user_id: userId,
      guild_id: guildId,
      channel_id: channelId,
      started_at: startedAt,
      ended_at: null,
      duration_seconds: null,
      is_active: true,
    };
  }

  async endActiveSession(
    userId: string,
    guildId: string
  ): Promise<VoiceSession | null> {
    // Find active session
    const sessions = await this.db.query<(VoiceSession & RowDataPacket)[]>(
      `SELECT * FROM voicetime_sessions
       WHERE user_id = ? AND guild_id = ? AND is_active = TRUE
       LIMIT 1`,
      [userId, guildId]
    );

    const session = sessions[0];
    if (!session) return null;

    const endedAt = new Date();
    const durationSeconds = Math.floor(
      (endedAt.getTime() - new Date(session.started_at).getTime()) / 1000
    );

    // Update session
    await this.db.execute(
      `UPDATE voicetime_sessions
       SET ended_at = ?, duration_seconds = ?, is_active = FALSE
       WHERE id = ?`,
      [endedAt, durationSeconds, session.id]
    );

    // Update aggregated stats
    await this.updateStats(userId, guildId, durationSeconds);

    logger.debug(
      `Ended voice session for user ${userId}, duration: ${durationSeconds}s`
    );

    // Emit session ended event
    const eventData: VoiceSessionEndedEvent = {
      userId,
      guildId,
      channelId: session.channel_id,
      duration: durationSeconds,
      startTime: new Date(session.started_at),
      endTime: endedAt,
    };
    this.eventBus.emitAsync(MODULE_EVENTS.VOICE_SESSION_ENDED, this.moduleId, eventData);

    return {
      ...session,
      ended_at: endedAt,
      duration_seconds: durationSeconds,
      is_active: false,
    };
  }

  async getActiveSession(
    userId: string,
    guildId: string
  ): Promise<VoiceSession | null> {
    const sessions = await this.db.query<(VoiceSession & RowDataPacket)[]>(
      `SELECT * FROM voicetime_sessions
       WHERE user_id = ? AND guild_id = ? AND is_active = TRUE
       LIMIT 1`,
      [userId, guildId]
    );
    return sessions[0] || null;
  }

  // ==================== Stats ====================

  private async updateStats(
    userId: string,
    guildId: string,
    additionalSeconds: number
  ): Promise<void> {
    // Upsert stats
    const existing = await this.getStats(userId, guildId);

    if (existing) {
      await this.db.execute(
        `UPDATE voicetime_stats
         SET total_seconds = total_seconds + ?,
             session_count = session_count + 1,
             last_session_at = NOW()
         WHERE user_id = ? AND guild_id = ?`,
        [additionalSeconds, userId, guildId]
      );
    } else {
      await this.db.execute(
        `INSERT INTO voicetime_stats (id, user_id, guild_id, total_seconds, session_count, last_session_at)
         VALUES (?, ?, ?, ?, 1, NOW())`,
        [randomUUID(), userId, guildId, additionalSeconds]
      );
    }
  }

  async getStats(userId: string, guildId: string): Promise<VoiceStats | null> {
    const rows = await this.db.query<(VoiceStats & RowDataPacket)[]>(
      'SELECT * FROM voicetime_stats WHERE user_id = ? AND guild_id = ?',
      [userId, guildId]
    );
    return rows[0] || null;
  }

  async getStatsWithActiveTime(
    userId: string,
    guildId: string
  ): Promise<{ totalSeconds: number; sessionCount: number; isInVoice: boolean }> {
    const stats = await this.getStats(userId, guildId);
    const activeSession = await this.getActiveSession(userId, guildId);

    let totalSeconds = stats?.total_seconds ?? 0;
    const sessionCount = stats?.session_count ?? 0;

    // Add time from active session
    if (activeSession) {
      const activeSeconds = Math.floor(
        (Date.now() - new Date(activeSession.started_at).getTime()) / 1000
      );
      totalSeconds += activeSeconds;
    }

    return {
      totalSeconds,
      sessionCount: sessionCount + (activeSession ? 1 : 0),
      isInVoice: !!activeSession,
    };
  }

  // ==================== Leaderboard ====================

  async getLeaderboard(
    guildId: string,
    limit: number = 10,
    offset: number = 0
  ): Promise<VoiceStats[]> {
    const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
    const safeOffset = Math.max(0, Math.floor(offset));
    return this.db.query<(VoiceStats & RowDataPacket)[]>(
      `SELECT * FROM voicetime_stats
       WHERE guild_id = ? AND total_seconds > 0
       ORDER BY total_seconds DESC
       LIMIT ${safeLimit} OFFSET ${safeOffset}`,
      [guildId]
    );
  }

  async getUserRank(userId: string, guildId: string): Promise<number> {
    const result = await this.db.query<({ user_rank: number } & RowDataPacket)[]>(
      `SELECT COUNT(*) + 1 as user_rank
       FROM voicetime_stats
       WHERE guild_id = ? AND total_seconds > (
         SELECT COALESCE(total_seconds, 0) FROM voicetime_stats
         WHERE user_id = ? AND guild_id = ?
       )`,
      [guildId, userId, guildId]
    );
    return result[0]?.user_rank ?? 0;
  }

  async getTotalUsers(guildId: string): Promise<number> {
    const result = await this.db.query<({ count: number } & RowDataPacket)[]>(
      'SELECT COUNT(*) as count FROM voicetime_stats WHERE guild_id = ? AND total_seconds > 0',
      [guildId]
    );
    return result[0]?.count ?? 0;
  }

  // ==================== Recent Sessions ====================

  async getRecentSessions(
    userId: string,
    guildId: string,
    limit: number = 10
  ): Promise<VoiceSession[]> {
    const safeLimit = Math.max(1, Math.min(50, Math.floor(limit)));
    return this.db.query<(VoiceSession & RowDataPacket)[]>(
      `SELECT * FROM voicetime_sessions
       WHERE user_id = ? AND guild_id = ? AND is_active = FALSE
       ORDER BY started_at DESC
       LIMIT ${safeLimit}`,
      [userId, guildId]
    );
  }

  // ==================== Cleanup ====================

  async cleanupStaleSessions(maxAgeHours: number = 24): Promise<number> {
    // End sessions that have been "active" for too long (bot restart, etc.)
    const cutoff = new Date(Date.now() - maxAgeHours * 60 * 60 * 1000);

    const stale = await this.db.query<(VoiceSession & RowDataPacket)[]>(
      `SELECT * FROM voicetime_sessions
       WHERE is_active = TRUE AND started_at < ?`,
      [cutoff]
    );

    for (const session of stale) {
      // End at cutoff time (we don't know when they actually left)
      const durationSeconds = Math.floor(
        (cutoff.getTime() - new Date(session.started_at).getTime()) / 1000
      );

      await this.db.execute(
        `UPDATE voicetime_sessions
         SET ended_at = ?, duration_seconds = ?, is_active = FALSE
         WHERE id = ?`,
        [cutoff, durationSeconds, session.id]
      );

      await this.updateStats(session.user_id, session.guild_id, durationSeconds);
    }

    if (stale.length > 0) {
      logger.info(`Cleaned up ${stale.length} stale voice sessions`);
    }

    return stale.length;
  }
}
