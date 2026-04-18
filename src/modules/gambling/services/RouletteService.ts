import { DatabaseService, RowDataPacket } from '../../../core/database/postgres.js';
import { Logger } from '../../../shared/utils/logger.js';
import { randomUUID } from 'crypto';
import { RouletteGame, RouletteBet } from '../types.js';

const logger = new Logger('Gambling:RouletteService');

export class RouletteService {
  constructor(private db: DatabaseService) {}

  async getActiveGame(voiceChannelId: string): Promise<RouletteGame | null> {
    const rows = await this.db.query<(RouletteGame & RowDataPacket)[]>(
      `SELECT * FROM gambling_roulette_games
       WHERE voice_channel_id = ? AND status != 'finished'`,
      [voiceChannelId]
    );
    return rows[0] || null;
  }

  async getGameById(gameId: string): Promise<RouletteGame | null> {
    const rows = await this.db.query<(RouletteGame & RowDataPacket)[]>(
      'SELECT * FROM gambling_roulette_games WHERE id = ?',
      [gameId]
    );
    return rows[0] || null;
  }

  async createGame(
    guildId: string,
    channelId: string,
    voiceChannelId: string,
    bettingDurationSeconds: number = 30
  ): Promise<RouletteGame> {
    // Delete any existing games for this voice channel
    await this.db.execute(
      'DELETE FROM gambling_roulette_games WHERE voice_channel_id = ?',
      [voiceChannelId]
    );

    const id = randomUUID();
    const bettingEndsAt = new Date(Date.now() + bettingDurationSeconds * 1000);

    await this.db.execute(
      `INSERT INTO gambling_roulette_games
       (id, guild_id, channel_id, voice_channel_id, status, betting_ends_at)
       VALUES (?, ?, ?, ?, 'betting', ?)`,
      [id, guildId, channelId, voiceChannelId, bettingEndsAt]
    );

    return {
      id,
      guild_id: guildId,
      channel_id: channelId,
      voice_channel_id: voiceChannelId,
      message_id: null,
      status: 'betting',
      result_number: null,
      result_color: null,
      betting_ends_at: bettingEndsAt,
      created_at: new Date(),
    };
  }

  async updateGame(
    gameId: string,
    updates: Partial<Pick<RouletteGame, 'message_id' | 'status' | 'result_number' | 'result_color'>>
  ): Promise<void> {
    const setClauses: string[] = [];
    const params: unknown[] = [];

    if (updates.message_id !== undefined) {
      setClauses.push('message_id = ?');
      params.push(updates.message_id);
    }
    if (updates.status !== undefined) {
      setClauses.push('status = ?');
      params.push(updates.status);
    }
    if (updates.result_number !== undefined) {
      setClauses.push('result_number = ?');
      params.push(updates.result_number);
    }
    if (updates.result_color !== undefined) {
      setClauses.push('result_color = ?');
      params.push(updates.result_color);
    }

    if (setClauses.length === 0) return;

    params.push(gameId);
    await this.db.execute(
      `UPDATE gambling_roulette_games SET ${setClauses.join(', ')} WHERE id = ?`,
      params
    );
  }

  async deleteGame(gameId: string): Promise<void> {
    await this.db.execute(
      'DELETE FROM gambling_roulette_games WHERE id = ?',
      [gameId]
    );
  }

  async getAllGames(): Promise<RouletteGame[]> {
    return this.db.query<(RouletteGame & RowDataPacket)[]>(
      'SELECT * FROM gambling_roulette_games',
      []
    );
  }

  async addBet(
    gameId: string,
    userId: string,
    betType: string,
    betAmount: number,
    betNumber: number | null = null
  ): Promise<RouletteBet> {
    // Merge with existing bet on the same type+number for this user
    const existing = await this.db.query<(RouletteBet & RowDataPacket)[]>(
      `SELECT * FROM gambling_roulette_bets
       WHERE game_id = ? AND user_id = ? AND bet_type = ? AND ${betNumber !== null ? 'bet_number = ?' : 'bet_number IS NULL'}`,
      betNumber !== null ? [gameId, userId, betType, betNumber] : [gameId, userId, betType]
    );

    if (existing[0]) {
      // Add to existing bet
      const newAmount = Number(existing[0].bet_amount) + betAmount;
      await this.db.execute(
        'UPDATE gambling_roulette_bets SET bet_amount = ? WHERE id = ?',
        [newAmount, existing[0].id]
      );
      return { ...existing[0], bet_amount: newAmount };
    }

    // Create new bet
    const id = randomUUID();
    await this.db.execute(
      `INSERT INTO gambling_roulette_bets
       (id, game_id, user_id, bet_type, bet_number, bet_amount, outcome)
       VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
      [id, gameId, userId, betType, betNumber, betAmount]
    );

    return {
      id,
      game_id: gameId,
      user_id: userId,
      bet_type: betType,
      bet_number: betNumber,
      bet_amount: betAmount,
      payout: 0,
      outcome: 'pending',
      created_at: new Date(),
    };
  }

  async getPlayerBets(gameId: string, userId: string): Promise<RouletteBet[]> {
    return this.db.query<(RouletteBet & RowDataPacket)[]>(
      'SELECT * FROM gambling_roulette_bets WHERE game_id = ? AND user_id = ? ORDER BY created_at',
      [gameId, userId]
    );
  }

  async getAllBets(gameId: string): Promise<RouletteBet[]> {
    return this.db.query<(RouletteBet & RowDataPacket)[]>(
      'SELECT * FROM gambling_roulette_bets WHERE game_id = ? ORDER BY user_id, created_at',
      [gameId]
    );
  }

  async getPlayerTotalBet(gameId: string, userId: string): Promise<number> {
    const result = await this.db.query<({ total: number } & RowDataPacket)[]>(
      'SELECT COALESCE(SUM(bet_amount), 0) as total FROM gambling_roulette_bets WHERE game_id = ? AND user_id = ?',
      [gameId, userId]
    );
    return result[0]?.total ?? 0;
  }

  async removeBet(betId: string, userId: string): Promise<RouletteBet | null> {
    const rows = await this.db.query<(RouletteBet & RowDataPacket)[]>(
      'SELECT * FROM gambling_roulette_bets WHERE id = ? AND user_id = ?',
      [betId, userId]
    );

    if (!rows[0]) return null;

    await this.db.execute(
      'DELETE FROM gambling_roulette_bets WHERE id = ? AND user_id = ?',
      [betId, userId]
    );

    return rows[0];
  }

  async clearPlayerBets(gameId: string, userId: string): Promise<number> {
    const result = await this.db.execute(
      'DELETE FROM gambling_roulette_bets WHERE game_id = ? AND user_id = ?',
      [gameId, userId]
    );
    return (result as { affectedRows: number }).affectedRows || 0;
  }

  async updateBetOutcomes(
    gameId: string,
    resultNumber: number,
    calculatePayout: (betType: string, betNumber: number | null, betAmount: number) => { won: boolean; payout: number }
  ): Promise<{ totalPayouts: number; betResults: Array<RouletteBet & { won: boolean }> }> {
    const bets = await this.getAllBets(gameId);
    let totalPayouts = 0;
    const betResults: Array<RouletteBet & { won: boolean }> = [];

    for (const bet of bets) {
      const { won, payout } = calculatePayout(bet.bet_type, bet.bet_number, Number(bet.bet_amount));

      await this.db.execute(
        'UPDATE gambling_roulette_bets SET outcome = ?, payout = ? WHERE id = ?',
        [won ? 'win' : 'loss', payout, bet.id]
      );

      totalPayouts += payout;
      betResults.push({ ...bet, payout, outcome: won ? 'win' : 'loss', won });
    }

    return { totalPayouts, betResults };
  }

  async getUniquePlayersInGame(gameId: string): Promise<string[]> {
    const result = await this.db.query<({ user_id: string } & RowDataPacket)[]>(
      'SELECT DISTINCT user_id FROM gambling_roulette_bets WHERE game_id = ?',
      [gameId]
    );
    return result.map(r => r.user_id);
  }

  async resetForNewRound(gameId: string, durationSeconds: number): Promise<void> {
    // Clear all bets from the previous round
    await this.db.execute(
      'DELETE FROM gambling_roulette_bets WHERE game_id = ?',
      [gameId]
    );

    // Reset the game state for a new betting phase
    const bettingEndsAt = new Date(Date.now() + durationSeconds * 1000);
    await this.db.execute(
      `UPDATE gambling_roulette_games
       SET status = 'betting', result_number = NULL, result_color = NULL, betting_ends_at = ?
       WHERE id = ?`,
      [bettingEndsAt, gameId]
    );
  }

  async getBetCount(gameId: string): Promise<number> {
    const result = await this.db.query<({ count: number } & RowDataPacket)[]>(
      'SELECT COUNT(*) as count FROM gambling_roulette_bets WHERE game_id = ?',
      [gameId]
    );
    return result[0]?.count ?? 0;
  }

  async getExpiredGames(): Promise<RouletteGame[]> {
    // Games stuck in 'betting' where betting ended 10+ min ago,
    // OR games stuck in 'spinning' for 10+ min (crashed session safety net).
    return this.db.query<(RouletteGame & RowDataPacket)[]>(
      `SELECT * FROM gambling_roulette_games
       WHERE (status = 'betting' AND betting_ends_at < NOW() - INTERVAL '10 minutes')
          OR (status = 'spinning' AND betting_ends_at < NOW() - INTERVAL '10 minutes')`,
      []
    );
  }
}
