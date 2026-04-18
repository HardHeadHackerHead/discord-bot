import { DatabaseService, RowDataPacket } from '../../../core/database/postgres.js';
import { Logger } from '../../../shared/utils/logger.js';
import { randomUUID } from 'crypto';
import { BlackjackGame, Card } from '../types.js';

const logger = new Logger('Gambling:BlackjackService');

export class BlackjackService {
  constructor(private db: DatabaseService) {}

  async getActiveGame(userId: string, guildId: string): Promise<BlackjackGame | null> {
    // No expires_at filter — games persist until finished or explicitly cleaned up.
    // This prevents the bug where an "expired" game silently eats the user's bet.
    const rows = await this.db.query<(BlackjackGame & RowDataPacket)[]>(
      `SELECT * FROM gambling_blackjack_games
       WHERE user_id = ? AND guild_id = ? AND status != 'finished'`,
      [userId, guildId]
    );

    if (!rows[0]) return null;

    return this.parseGame(rows[0]);
  }

  async getExpiredGames(): Promise<BlackjackGame[]> {
    // Only clean up games older than 24 hours as a safety net
    const rows = await this.db.query<(BlackjackGame & RowDataPacket)[]>(
      `SELECT * FROM gambling_blackjack_games
       WHERE status != 'finished' AND expires_at < NOW() - INTERVAL '24 hours'`,
      []
    );
    return rows.map(row => this.parseGame(row));
  }

  private parseGame(game: BlackjackGame & RowDataPacket): BlackjackGame {
    const parseIfNeeded = (val: unknown): Card[] => {
      if (val === null || val === undefined) return [];
      if (typeof val === 'string') return JSON.parse(val);
      return val as Card[];
    };

    const parseIfNeededNullable = (val: unknown): Card[] | null => {
      if (val === null || val === undefined) return null;
      if (typeof val === 'string') return JSON.parse(val);
      return val as Card[];
    };

    return {
      ...game,
      bet_amount: Number(game.bet_amount),
      split_bet_amount: Number(game.split_bet_amount ?? 0),
      player_hand: parseIfNeeded(game.player_hand),
      split_hand: parseIfNeededNullable(game.split_hand),
      dealer_hand: parseIfNeeded(game.dealer_hand),
      deck: parseIfNeeded(game.deck),
      has_split: Boolean(game.has_split),
      current_hand: game.current_hand ?? 'main',
      main_hand_status: game.main_hand_status ?? 'playing',
      split_hand_status: game.split_hand_status ?? null,
    };
  }

  async createGame(
    userId: string,
    guildId: string,
    channelId: string,
    betAmount: number,
    playerHand: Card[],
    dealerHand: Card[],
    deck: Card[]
  ): Promise<BlackjackGame> {
    // Delete any existing games for this user
    // (caller should have already checked and refunded if needed)
    await this.db.execute(
      'DELETE FROM gambling_blackjack_games WHERE user_id = ? AND guild_id = ?',
      [userId, guildId]
    );

    const id = randomUUID();
    // expires_at is kept for the cleanup safety net (24h), not for blocking gameplay
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await this.db.execute(
      `INSERT INTO gambling_blackjack_games
       (id, user_id, guild_id, channel_id, bet_amount, split_bet_amount, player_hand, split_hand, dealer_hand, deck, status, current_hand, main_hand_status, split_hand_status, has_split, expires_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, NULL, ?, ?, 'playing', 'main', 'playing', NULL, FALSE, ?)`,
      [
        id,
        userId,
        guildId,
        channelId,
        betAmount,
        JSON.stringify(playerHand),
        JSON.stringify(dealerHand),
        JSON.stringify(deck),
        expiresAt,
      ]
    );

    return {
      id,
      user_id: userId,
      guild_id: guildId,
      channel_id: channelId,
      message_id: null,
      bet_amount: betAmount,
      split_bet_amount: 0,
      player_hand: playerHand,
      split_hand: null,
      dealer_hand: dealerHand,
      deck,
      status: 'playing',
      current_hand: 'main',
      main_hand_status: 'playing',
      split_hand_status: null,
      has_split: false,
      created_at: new Date(),
      expires_at: expiresAt,
    };
  }

  async updateGame(
    gameId: string,
    updates: Partial<Pick<BlackjackGame,
      'player_hand' | 'split_hand' | 'dealer_hand' | 'deck' | 'status' | 'message_id' |
      'current_hand' | 'main_hand_status' | 'split_hand_status' | 'has_split' | 'split_bet_amount'
    >>
  ): Promise<void> {
    const setClauses: string[] = [];
    const params: unknown[] = [];

    if (updates.player_hand !== undefined) {
      setClauses.push('player_hand = ?');
      params.push(JSON.stringify(updates.player_hand));
    }
    if (updates.split_hand !== undefined) {
      setClauses.push('split_hand = ?');
      params.push(updates.split_hand ? JSON.stringify(updates.split_hand) : null);
    }
    if (updates.dealer_hand !== undefined) {
      setClauses.push('dealer_hand = ?');
      params.push(JSON.stringify(updates.dealer_hand));
    }
    if (updates.deck !== undefined) {
      setClauses.push('deck = ?');
      params.push(JSON.stringify(updates.deck));
    }
    if (updates.status !== undefined) {
      setClauses.push('status = ?');
      params.push(updates.status);
    }
    if (updates.message_id !== undefined) {
      setClauses.push('message_id = ?');
      params.push(updates.message_id);
    }
    if (updates.current_hand !== undefined) {
      setClauses.push('current_hand = ?');
      params.push(updates.current_hand);
    }
    if (updates.main_hand_status !== undefined) {
      setClauses.push('main_hand_status = ?');
      params.push(updates.main_hand_status);
    }
    if (updates.split_hand_status !== undefined) {
      setClauses.push('split_hand_status = ?');
      params.push(updates.split_hand_status);
    }
    if (updates.has_split !== undefined) {
      setClauses.push('has_split = ?');
      params.push(updates.has_split);
    }
    if (updates.split_bet_amount !== undefined) {
      setClauses.push('split_bet_amount = ?');
      params.push(updates.split_bet_amount);
    }

    if (setClauses.length === 0) return;

    params.push(gameId);
    await this.db.execute(
      `UPDATE gambling_blackjack_games SET ${setClauses.join(', ')} WHERE id = ?`,
      params
    );
  }

  async deleteGame(gameId: string): Promise<void> {
    await this.db.execute(
      'DELETE FROM gambling_blackjack_games WHERE id = ?',
      [gameId]
    );
  }

  async getAllUnfinishedGames(): Promise<BlackjackGame[]> {
    const rows = await this.db.query<(BlackjackGame & RowDataPacket)[]>(
      `SELECT * FROM gambling_blackjack_games WHERE status != 'finished'`,
      []
    );
    return rows.map(row => this.parseGame(row));
  }
}
