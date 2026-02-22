import { DatabaseService } from '../../../core/database/mysql.js';
import { ModuleEventBus } from '../../../core/modules/ModuleEventBus.js';
import { Logger } from '../../../shared/utils/logger.js';
import { RowDataPacket } from 'mysql2';
import { randomUUID } from 'crypto';
import { MODULE_EVENTS, MessageCountedEvent } from '../../../types/module-events.types.js';

const logger = new Logger('MessageTracking:Service');

export interface MessageStats {
  id: string;
  user_id: string;
  guild_id: string;
  message_count: number;
  last_message_at: Date | null;
  last_counted_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface DailyMessageStats {
  id: string;
  user_id: string;
  guild_id: string;
  date: Date;
  message_count: number;
  created_at: Date;
}

export class MessageTrackingService {
  private moduleId = 'message-tracking';

  constructor(
    private db: DatabaseService,
    private eventBus: ModuleEventBus
  ) {}

  // ==================== Message Counting ====================

  /**
   * Record a message and check cooldown
   * Returns true if the message was counted (not on cooldown)
   */
  async recordMessage(
    userId: string,
    guildId: string,
    channelId: string,
    messageId: string,
    cooldownSeconds: number = 60
  ): Promise<{ counted: boolean; newCount: number }> {
    const stats = await this.getOrCreateStats(userId, guildId);
    const now = new Date();

    // Check cooldown
    if (stats.last_counted_at) {
      const timeSinceLastCounted = (now.getTime() - new Date(stats.last_counted_at).getTime()) / 1000;
      if (timeSinceLastCounted < cooldownSeconds) {
        // On cooldown - update last_message_at but don't count
        await this.db.execute(
          `UPDATE messages_stats SET last_message_at = ? WHERE id = ?`,
          [now, stats.id]
        );
        return { counted: false, newCount: stats.message_count };
      }
    }

    // Count the message
    const newCount = stats.message_count + 1;
    await this.db.execute(
      `UPDATE messages_stats
       SET message_count = ?, last_message_at = ?, last_counted_at = ?
       WHERE id = ?`,
      [newCount, now, now, stats.id]
    );

    // Update daily stats
    await this.updateDailyStats(userId, guildId);

    logger.debug(`Counted message for user ${userId} in guild ${guildId}, new count: ${newCount}`);

    // Emit event for other modules (like Points)
    const eventData: MessageCountedEvent = {
      userId,
      guildId,
      channelId,
      messageId,
      newCount,
    };
    this.eventBus.emitAsync(MODULE_EVENTS.MESSAGE_COUNTED, this.moduleId, eventData);

    return { counted: true, newCount };
  }

  // ==================== Stats Management ====================

  async getStats(userId: string, guildId: string): Promise<MessageStats | null> {
    const rows = await this.db.query<(MessageStats & RowDataPacket)[]>(
      'SELECT * FROM messages_stats WHERE user_id = ? AND guild_id = ?',
      [userId, guildId]
    );
    return rows[0] || null;
  }

  async getOrCreateStats(userId: string, guildId: string): Promise<MessageStats> {
    let stats = await this.getStats(userId, guildId);

    if (!stats) {
      const id = randomUUID();
      await this.db.execute(
        `INSERT INTO messages_stats (id, user_id, guild_id, message_count)
         VALUES (?, ?, ?, 0)`,
        [id, userId, guildId]
      );
      stats = {
        id,
        user_id: userId,
        guild_id: guildId,
        message_count: 0,
        last_message_at: null,
        last_counted_at: null,
        created_at: new Date(),
        updated_at: new Date(),
      };
    }

    return stats;
  }

  // ==================== Daily Stats ====================

  private async updateDailyStats(userId: string, guildId: string): Promise<void> {
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

    // Try to update existing record, or insert new one
    const existing = await this.db.query<(DailyMessageStats & RowDataPacket)[]>(
      'SELECT * FROM messages_daily_stats WHERE user_id = ? AND guild_id = ? AND date = ?',
      [userId, guildId, today]
    );

    if (existing[0]) {
      await this.db.execute(
        `UPDATE messages_daily_stats SET message_count = message_count + 1 WHERE id = ?`,
        [existing[0].id]
      );
    } else {
      await this.db.execute(
        `INSERT INTO messages_daily_stats (id, user_id, guild_id, date, message_count)
         VALUES (?, ?, ?, ?, 1)`,
        [randomUUID(), userId, guildId, today]
      );
    }
  }

  async getDailyStats(
    userId: string,
    guildId: string,
    days: number = 7
  ): Promise<DailyMessageStats[]> {
    const safeDays = Math.max(1, Math.min(30, days));
    return this.db.query<(DailyMessageStats & RowDataPacket)[]>(
      `SELECT * FROM messages_daily_stats
       WHERE user_id = ? AND guild_id = ? AND date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
       ORDER BY date DESC`,
      [userId, guildId, safeDays]
    );
  }

  // ==================== Leaderboard ====================

  async getLeaderboard(
    guildId: string,
    limit: number = 10,
    offset: number = 0
  ): Promise<MessageStats[]> {
    const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
    const safeOffset = Math.max(0, Math.floor(offset));
    return this.db.query<(MessageStats & RowDataPacket)[]>(
      `SELECT * FROM messages_stats
       WHERE guild_id = ? AND message_count > 0
       ORDER BY message_count DESC
       LIMIT ${safeLimit} OFFSET ${safeOffset}`,
      [guildId]
    );
  }

  async getUserRank(userId: string, guildId: string): Promise<number> {
    const result = await this.db.query<({ user_rank: number } & RowDataPacket)[]>(
      `SELECT COUNT(*) + 1 as user_rank
       FROM messages_stats
       WHERE guild_id = ? AND message_count > (
         SELECT COALESCE(message_count, 0) FROM messages_stats
         WHERE user_id = ? AND guild_id = ?
       )`,
      [guildId, userId, guildId]
    );
    return result[0]?.user_rank ?? 0;
  }

  async getTotalUsers(guildId: string): Promise<number> {
    const result = await this.db.query<({ count: number } & RowDataPacket)[]>(
      'SELECT COUNT(*) as count FROM messages_stats WHERE guild_id = ? AND message_count > 0',
      [guildId]
    );
    return result[0]?.count ?? 0;
  }

  // ==================== Today's Stats ====================

  async getTodayMessageCount(userId: string, guildId: string): Promise<number> {
    const today = new Date().toISOString().split('T')[0];
    const result = await this.db.query<(DailyMessageStats & RowDataPacket)[]>(
      'SELECT message_count FROM messages_daily_stats WHERE user_id = ? AND guild_id = ? AND date = ?',
      [userId, guildId, today]
    );
    return result[0]?.message_count ?? 0;
  }
}
