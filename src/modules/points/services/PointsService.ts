import { DatabaseService } from '../../../core/database/mysql.js';
import { ModuleEventBus } from '../../../core/modules/ModuleEventBus.js';
import { Logger } from '../../../shared/utils/logger.js';
import { RowDataPacket } from 'mysql2';
import { randomUUID } from 'crypto';
import { MODULE_EVENTS, PointsAwardedEvent, PointsRemovedEvent } from '../../../types/module-events.types.js';

const logger = new Logger('Points:Service');

export interface UserPoints {
  id: string;
  user_id: string;
  guild_id: string;
  balance: number;
  lifetime_earned: number;
  created_at: Date;
  updated_at: Date;
}

export interface PointsTransaction {
  id: string;
  user_id: string;
  guild_id: string;
  amount: number;
  balance_after: number;
  reason: string | null;
  source: string;
  source_user_id: string | null;
  created_at: Date;
}

export interface GuildPointsSettings {
  id: string;
  guild_id: string;
  message_points: number;
  message_cooldown: number;
  voice_points_per_minute: number;
  daily_bonus: number;
}

export type PointsSource = 'manual' | 'voice' | 'message' | 'daily' | 'other';

export class PointsService {
  private moduleId = 'points';

  constructor(
    private db: DatabaseService,
    private eventBus: ModuleEventBus
  ) {}

  // ==================== Points Balance ====================

  async getPoints(userId: string, guildId: string): Promise<UserPoints | null> {
    const rows = await this.db.query<(UserPoints & RowDataPacket)[]>(
      'SELECT * FROM points_user_points WHERE user_id = ? AND guild_id = ?',
      [userId, guildId]
    );
    return rows[0] || null;
  }

  async getOrCreatePoints(userId: string, guildId: string): Promise<UserPoints> {
    let points = await this.getPoints(userId, guildId);

    if (!points) {
      const id = randomUUID();
      await this.db.execute(
        `INSERT INTO points_user_points (id, user_id, guild_id, balance, lifetime_earned)
         VALUES (?, ?, ?, 0, 0)`,
        [id, userId, guildId]
      );
      points = {
        id,
        user_id: userId,
        guild_id: guildId,
        balance: 0,
        lifetime_earned: 0,
        created_at: new Date(),
        updated_at: new Date(),
      };
    }

    return points;
  }

  async addPoints(
    userId: string,
    guildId: string,
    amount: number,
    reason: string,
    source: PointsSource,
    sourceUserId?: string
  ): Promise<{ newBalance: number; transaction: PointsTransaction }> {
    const points = await this.getOrCreatePoints(userId, guildId);
    const newBalance = points.balance + amount;
    const newLifetime = points.lifetime_earned + (amount > 0 ? amount : 0);

    // Update balance
    await this.db.execute(
      `UPDATE points_user_points
       SET balance = ?, lifetime_earned = ?, updated_at = NOW()
       WHERE user_id = ? AND guild_id = ?`,
      [newBalance, newLifetime, userId, guildId]
    );

    // Create transaction record
    const transactionId = randomUUID();
    await this.db.execute(
      `INSERT INTO points_transactions
       (id, user_id, guild_id, amount, balance_after, reason, source, source_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [transactionId, userId, guildId, amount, newBalance, reason, source, sourceUserId || null]
    );

    const transaction: PointsTransaction = {
      id: transactionId,
      user_id: userId,
      guild_id: guildId,
      amount,
      balance_after: newBalance,
      reason,
      source,
      source_user_id: sourceUserId || null,
      created_at: new Date(),
    };

    logger.debug(
      `${amount > 0 ? 'Added' : 'Removed'} ${Math.abs(amount)} points ` +
      `${amount > 0 ? 'to' : 'from'} user ${userId} in guild ${guildId}. ` +
      `New balance: ${newBalance}`
    );

    // Emit event
    if (amount > 0) {
      const eventData: PointsAwardedEvent = {
        userId,
        guildId,
        amount,
        reason,
        source,
        newBalance,
      };
      this.eventBus.emitAsync(MODULE_EVENTS.POINTS_AWARDED, this.moduleId, eventData);
    } else if (amount < 0) {
      const eventData: PointsRemovedEvent = {
        userId,
        guildId,
        amount: Math.abs(amount),
        reason,
        newBalance,
      };
      this.eventBus.emitAsync(MODULE_EVENTS.POINTS_REMOVED, this.moduleId, eventData);
    }

    return { newBalance, transaction };
  }

  async removePoints(
    userId: string,
    guildId: string,
    amount: number,
    reason: string,
    sourceUserId?: string
  ): Promise<{ newBalance: number; transaction: PointsTransaction }> {
    return this.addPoints(userId, guildId, -Math.abs(amount), reason, 'manual', sourceUserId);
  }

  async setPoints(
    userId: string,
    guildId: string,
    amount: number,
    reason: string,
    sourceUserId?: string
  ): Promise<{ newBalance: number; transaction: PointsTransaction }> {
    const points = await this.getOrCreatePoints(userId, guildId);
    const diff = amount - points.balance;
    return this.addPoints(userId, guildId, diff, reason, 'manual', sourceUserId);
  }

  // ==================== Leaderboard ====================

  async getLeaderboard(
    guildId: string,
    limit: number = 10,
    offset: number = 0
  ): Promise<UserPoints[]> {
    // LIMIT/OFFSET don't work well with prepared statement placeholders in some MySQL versions
    const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
    const safeOffset = Math.max(0, Math.floor(offset));
    return this.db.query<(UserPoints & RowDataPacket)[]>(
      `SELECT * FROM points_user_points
       WHERE guild_id = ? AND balance > 0
       ORDER BY balance DESC
       LIMIT ${safeLimit} OFFSET ${safeOffset}`,
      [guildId]
    );
  }

  async getLifetimeLeaderboard(
    guildId: string,
    limit: number = 10,
    offset: number = 0
  ): Promise<UserPoints[]> {
    const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
    const safeOffset = Math.max(0, Math.floor(offset));
    return this.db.query<(UserPoints & RowDataPacket)[]>(
      `SELECT * FROM points_user_points
       WHERE guild_id = ? AND lifetime_earned > 0
       ORDER BY lifetime_earned DESC
       LIMIT ${safeLimit} OFFSET ${safeOffset}`,
      [guildId]
    );
  }

  async getUserRank(userId: string, guildId: string): Promise<number> {
    const result = await this.db.query<({ user_rank: number } & RowDataPacket)[]>(
      `SELECT COUNT(*) + 1 as user_rank
       FROM points_user_points
       WHERE guild_id = ? AND balance > (
         SELECT COALESCE(balance, 0) FROM points_user_points
         WHERE user_id = ? AND guild_id = ?
       )`,
      [guildId, userId, guildId]
    );
    return result[0]?.user_rank ?? 0;
  }

  async getUserLifetimeRank(userId: string, guildId: string): Promise<number> {
    const result = await this.db.query<({ user_rank: number } & RowDataPacket)[]>(
      `SELECT COUNT(*) + 1 as user_rank
       FROM points_user_points
       WHERE guild_id = ? AND lifetime_earned > (
         SELECT COALESCE(lifetime_earned, 0) FROM points_user_points
         WHERE user_id = ? AND guild_id = ?
       )`,
      [guildId, userId, guildId]
    );
    return result[0]?.user_rank ?? 0;
  }

  async getTotalUsers(guildId: string): Promise<number> {
    const result = await this.db.query<({ count: number } & RowDataPacket)[]>(
      'SELECT COUNT(*) as count FROM points_user_points WHERE guild_id = ? AND balance > 0',
      [guildId]
    );
    return result[0]?.count ?? 0;
  }

  async getTotalLifetimeUsers(guildId: string): Promise<number> {
    const result = await this.db.query<({ count: number } & RowDataPacket)[]>(
      'SELECT COUNT(*) as count FROM points_user_points WHERE guild_id = ? AND lifetime_earned > 0',
      [guildId]
    );
    return result[0]?.count ?? 0;
  }

  // ==================== Transaction History ====================

  async getTransactions(
    userId: string,
    guildId: string,
    limit: number = 10
  ): Promise<PointsTransaction[]> {
    // LIMIT doesn't work well with prepared statement placeholders in some MySQL versions
    const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
    return this.db.query<(PointsTransaction & RowDataPacket)[]>(
      `SELECT * FROM points_transactions
       WHERE user_id = ? AND guild_id = ?
       ORDER BY created_at DESC
       LIMIT ${safeLimit}`,
      [userId, guildId]
    );
  }

  // ==================== Guild Settings ====================

  async getGuildSettings(guildId: string): Promise<GuildPointsSettings> {
    const rows = await this.db.query<(GuildPointsSettings & RowDataPacket)[]>(
      'SELECT * FROM points_guild_settings WHERE guild_id = ?',
      [guildId]
    );

    if (rows[0]) return rows[0];

    // Create default settings
    const id = randomUUID();
    await this.db.execute(
      `INSERT INTO points_guild_settings
       (id, guild_id, message_points, message_cooldown, voice_points_per_minute, daily_bonus)
       VALUES (?, ?, 1, 60, 1, 0)`,
      [id, guildId]
    );

    return {
      id,
      guild_id: guildId,
      message_points: 1,
      message_cooldown: 60,
      voice_points_per_minute: 1,
      daily_bonus: 0,
    };
  }

  async updateGuildSettings(
    guildId: string,
    settings: Partial<Omit<GuildPointsSettings, 'id' | 'guild_id'>>
  ): Promise<void> {
    // Ensure settings exist
    await this.getGuildSettings(guildId);

    const updates: string[] = [];
    const values: unknown[] = [];

    if (settings.message_points !== undefined) {
      updates.push('message_points = ?');
      values.push(settings.message_points);
    }
    if (settings.message_cooldown !== undefined) {
      updates.push('message_cooldown = ?');
      values.push(settings.message_cooldown);
    }
    if (settings.voice_points_per_minute !== undefined) {
      updates.push('voice_points_per_minute = ?');
      values.push(settings.voice_points_per_minute);
    }
    if (settings.daily_bonus !== undefined) {
      updates.push('daily_bonus = ?');
      values.push(settings.daily_bonus);
    }

    if (updates.length === 0) return;

    values.push(guildId);

    await this.db.execute(
      `UPDATE points_guild_settings SET ${updates.join(', ')} WHERE guild_id = ?`,
      values
    );
  }
}
