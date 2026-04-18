import { DatabaseService, RowDataPacket } from '../../../core/database/postgres.js';
import { ModuleEventBus } from '../../../core/modules/ModuleEventBus.js';
import { Logger } from '../../../shared/utils/logger.js';
import { randomUUID } from 'crypto';
import { GamblingStats, GamblingHistory, GameType, GameResult } from '../types.js';

const logger = new Logger('Gambling:StatsService');

export class GamblingStatsService {
  constructor(
    private db: DatabaseService,
    private eventBus: ModuleEventBus
  ) {}

  // ==================== Stats Management ====================

  async getStats(userId: string, guildId: string): Promise<GamblingStats | null> {
    const rows = await this.db.query<(GamblingStats & RowDataPacket)[]>(
      'SELECT * FROM gambling_user_stats WHERE user_id = ? AND guild_id = ?',
      [userId, guildId]
    );
    return rows[0] || null;
  }

  async getOrCreateStats(userId: string, guildId: string): Promise<GamblingStats> {
    const existing = await this.getStats(userId, guildId);
    if (existing) return existing;

    const id = randomUUID();
    await this.db.execute(
      `INSERT INTO gambling_user_stats (id, user_id, guild_id)
       VALUES (?, ?, ?)`,
      [id, userId, guildId]
    );

    return {
      id,
      user_id: userId,
      guild_id: guildId,
      total_bets: 0,
      total_wagered: 0,
      total_won: 0,
      total_lost: 0,
      net_profit: 0,
      biggest_win: 0,
      biggest_loss: 0,
      current_streak: 0,
      best_win_streak: 0,
      worst_loss_streak: 0,
      coinflip_wins: 0,
      coinflip_losses: 0,
      slots_wins: 0,
      slots_losses: 0,
      roulette_wins: 0,
      roulette_losses: 0,
      blackjack_wins: 0,
      blackjack_losses: 0,
      blackjack_pushes: 0,
      rps_wins: 0,
      rps_losses: 0,
      bankruptcies: 0,
      created_at: new Date(),
      updated_at: new Date(),
    };
  }

  async recordGameResult(
    userId: string,
    guildId: string,
    gameType: GameType,
    betAmount: number,
    result: GameResult
  ): Promise<void> {
    await this.getOrCreateStats(userId, guildId);

    const profitLoss = result.payout - betAmount;
    const wonIncrement = result.outcome === 'win' ? result.payout : 0;
    const lostIncrement = result.outcome === 'loss' ? betAmount : 0;

    // Determine game-specific column updates
    const gameWinCol = `${gameType}_wins`;
    const gameLossCol = `${gameType}_losses`;
    const gamePushCol = gameType === 'blackjack' ? 'blackjack_pushes' : null;

    // All arithmetic done in SQL to avoid JS string-concatenation bugs
    // (Postgres can return bigint values as strings)
    let updateQuery = `
      UPDATE gambling_user_stats SET
        total_bets = total_bets + 1,
        total_wagered = total_wagered + ?,
        total_won = total_won + ?,
        total_lost = total_lost + ?,
        net_profit = net_profit + ?,
        biggest_win = GREATEST(biggest_win, ?),
        biggest_loss = LEAST(biggest_loss, ?),
        current_streak = CASE
          WHEN ? = 'win' THEN GREATEST(current_streak, 0) + 1
          WHEN ? = 'loss' THEN LEAST(current_streak, 0) - 1
          ELSE current_streak
        END,
        best_win_streak = GREATEST(best_win_streak, CASE
          WHEN ? = 'win' THEN GREATEST(current_streak, 0) + 1
          ELSE best_win_streak
        END),
        worst_loss_streak = LEAST(worst_loss_streak, CASE
          WHEN ? = 'loss' THEN LEAST(current_streak, 0) - 1
          ELSE worst_loss_streak
        END)
    `;

    const params: unknown[] = [
      betAmount,                                        // total_wagered +
      wonIncrement,                                     // total_won +
      lostIncrement,                                    // total_lost +
      profitLoss,                                       // net_profit +
      result.outcome === 'win' ? profitLoss : 0,        // biggest_win GREATEST
      result.outcome === 'loss' ? profitLoss : 0,       // biggest_loss LEAST
      result.outcome,                                   // streak CASE (win check)
      result.outcome,                                   // streak CASE (loss check)
      result.outcome,                                   // best_win_streak CASE
      result.outcome,                                   // worst_loss_streak CASE
    ];

    // Add game-specific win/loss updates
    if (result.outcome === 'win') {
      updateQuery += `, ${gameWinCol} = ${gameWinCol} + 1`;
    } else if (result.outcome === 'loss') {
      updateQuery += `, ${gameLossCol} = ${gameLossCol} + 1`;
    } else if (result.outcome === 'push' && gamePushCol) {
      updateQuery += `, ${gamePushCol} = ${gamePushCol} + 1`;
    }

    updateQuery += ` WHERE user_id = ? AND guild_id = ?`;
    params.push(userId, guildId);

    await this.db.execute(updateQuery, params);

    // Record in history
    const historyId = randomUUID();
    await this.db.execute(
      `INSERT INTO gambling_history
       (id, user_id, guild_id, game_type, bet_amount, outcome, payout, multiplier, game_data)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        historyId,
        userId,
        guildId,
        gameType,
        betAmount,
        result.outcome,
        result.payout,
        result.multiplier,
        result.gameData ? JSON.stringify(result.gameData) : null,
      ]
    );

    logger.debug(
      `Recorded ${gameType} result for user ${userId}: ` +
      `${result.outcome} (bet: ${betAmount}, payout: ${result.payout})`
    );
  }

  // ==================== Bankruptcy Tracking ====================

  async recordBankruptcy(userId: string, guildId: string): Promise<number> {
    await this.getOrCreateStats(userId, guildId);

    await this.db.execute(
      `UPDATE gambling_user_stats
       SET bankruptcies = bankruptcies + 1
       WHERE user_id = ? AND guild_id = ?`,
      [userId, guildId]
    );

    const stats = await this.getStats(userId, guildId);
    const count = (stats as GamblingStats & { bankruptcies?: number })?.bankruptcies ?? 1;

    logger.debug(`Recorded bankruptcy #${count} for user ${userId} in guild ${guildId}`);
    return count;
  }

  // ==================== Leaderboard ====================

  async getLeaderboard(
    guildId: string,
    limit: number = 10,
    offset: number = 0
  ): Promise<GamblingStats[]> {
    const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
    const safeOffset = Math.max(0, Math.floor(offset));
    return this.db.query<(GamblingStats & RowDataPacket)[]>(
      `SELECT * FROM gambling_user_stats
       WHERE guild_id = ? AND total_bets > 0
       ORDER BY net_profit DESC
       LIMIT ${safeLimit} OFFSET ${safeOffset}`,
      [guildId]
    );
  }

  async getUserRank(userId: string, guildId: string): Promise<number> {
    const result = await this.db.query<({ user_rank: number } & RowDataPacket)[]>(
      `SELECT COUNT(*) + 1 as user_rank
       FROM gambling_user_stats
       WHERE guild_id = ? AND net_profit > (
         SELECT COALESCE(net_profit, 0) FROM gambling_user_stats
         WHERE user_id = ? AND guild_id = ?
       )`,
      [guildId, userId, guildId]
    );
    return result[0]?.user_rank ?? 0;
  }

  async getTotalUsers(guildId: string): Promise<number> {
    const result = await this.db.query<({ count: number } & RowDataPacket)[]>(
      'SELECT COUNT(*) as count FROM gambling_user_stats WHERE guild_id = ? AND total_bets > 0',
      [guildId]
    );
    return result[0]?.count ?? 0;
  }

  // ==================== History ====================

  async getHistory(
    userId: string,
    guildId: string,
    limit: number = 10,
    gameType?: GameType
  ): Promise<GamblingHistory[]> {
    const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));

    if (gameType) {
      return this.db.query<(GamblingHistory & RowDataPacket)[]>(
        `SELECT * FROM gambling_history
         WHERE user_id = ? AND guild_id = ? AND game_type = ?
         ORDER BY created_at DESC
         LIMIT ${safeLimit}`,
        [userId, guildId, gameType]
      );
    }

    return this.db.query<(GamblingHistory & RowDataPacket)[]>(
      `SELECT * FROM gambling_history
       WHERE user_id = ? AND guild_id = ?
       ORDER BY created_at DESC
       LIMIT ${safeLimit}`,
      [userId, guildId]
    );
  }
}
