import { DatabaseService, RowDataPacket } from '../../../core/database/postgres.js';
import { Logger } from '../../../shared/utils/logger.js';
import { randomUUID } from 'crypto';
import { RPSChallenge, RPSChoice } from '../types.js';

const logger = new Logger('Gambling:RPSService');

const CHALLENGE_TIMEOUT_MS = 120_000; // 2 minutes to accept
const CHOICE_TIMEOUT_MS = 30_000; // 30 seconds to choose

export { CHOICE_TIMEOUT_MS };

export class RPSService {
  private choiceTimers = new Map<string, NodeJS.Timeout>();

  constructor(private db: DatabaseService) {}

  async createChallenge(
    guildId: string,
    channelId: string,
    challengerId: string,
    opponentId: string,
    betAmount: number
  ): Promise<RPSChallenge> {
    const id = randomUUID();
    const expiresAt = new Date(Date.now() + CHALLENGE_TIMEOUT_MS);

    await this.db.execute(
      `INSERT INTO gambling_rps_challenges
       (id, guild_id, channel_id, challenger_id, opponent_id, bet_amount, status, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
      [id, guildId, channelId, challengerId, opponentId, betAmount, expiresAt]
    );

    return {
      id,
      guild_id: guildId,
      channel_id: channelId,
      message_id: null,
      challenger_id: challengerId,
      opponent_id: opponentId,
      bet_amount: betAmount,
      status: 'pending',
      challenger_choice: null,
      opponent_choice: null,
      winner_id: null,
      expires_at: expiresAt,
      choice_deadline: null,
      created_at: new Date(),
    };
  }

  async getChallenge(id: string): Promise<RPSChallenge | null> {
    const rows = await this.db.query<(RPSChallenge & RowDataPacket)[]>(
      'SELECT * FROM gambling_rps_challenges WHERE id = ?',
      [id]
    );
    return rows[0] || null;
  }

  async setMessageId(id: string, messageId: string): Promise<void> {
    await this.db.execute(
      'UPDATE gambling_rps_challenges SET message_id = ? WHERE id = ?',
      [messageId, id]
    );
  }

  async acceptChallenge(id: string): Promise<boolean> {
    const choiceDeadline = new Date(Date.now() + CHOICE_TIMEOUT_MS);
    const result = await this.db.execute(
      `UPDATE gambling_rps_challenges
       SET status = 'accepted', choice_deadline = ?
       WHERE id = ? AND status = 'pending'`,
      [choiceDeadline, id]
    );
    return result.affectedRows > 0;
  }

  async declineChallenge(id: string): Promise<boolean> {
    const result = await this.db.execute(
      `UPDATE gambling_rps_challenges SET status = 'declined' WHERE id = ? AND status = 'pending'`,
      [id]
    );
    return result.affectedRows > 0;
  }

  async recordChoice(id: string, userId: string, choice: RPSChoice): Promise<RPSChallenge | null> {
    const challenge = await this.getChallenge(id);
    if (!challenge || challenge.status !== 'accepted') return null;

    if (userId === challenge.challenger_id) {
      if (challenge.challenger_choice) return null;
      await this.db.execute(
        'UPDATE gambling_rps_challenges SET challenger_choice = ? WHERE id = ?',
        [choice, id]
      );
    } else if (userId === challenge.opponent_id) {
      if (challenge.opponent_choice) return null;
      await this.db.execute(
        'UPDATE gambling_rps_challenges SET opponent_choice = ? WHERE id = ?',
        [choice, id]
      );
    } else {
      return null;
    }

    return this.getChallenge(id);
  }

  async completeChallenge(id: string, winnerId: string | null): Promise<boolean> {
    const result = await this.db.execute(
      `UPDATE gambling_rps_challenges SET status = 'completed', winner_id = ?
       WHERE id = ? AND status = 'accepted'`,
      [winnerId, id]
    );
    return result.affectedRows > 0;
  }

  async forfeitChallenge(id: string, winnerId: string | null): Promise<boolean> {
    const result = await this.db.execute(
      `UPDATE gambling_rps_challenges SET status = 'forfeited', winner_id = ?
       WHERE id = ? AND status = 'accepted'`,
      [winnerId, id]
    );
    return result.affectedRows > 0;
  }

  async expireChallenge(id: string): Promise<void> {
    await this.db.execute(
      `UPDATE gambling_rps_challenges SET status = 'expired' WHERE id = ?`,
      [id]
    );
  }

  async getExpiredPendingChallenges(): Promise<RPSChallenge[]> {
    return this.db.query<(RPSChallenge & RowDataPacket)[]>(
      `SELECT * FROM gambling_rps_challenges WHERE status = 'pending' AND expires_at < NOW()`
    );
  }

  async getExpiredAcceptedChallenges(): Promise<RPSChallenge[]> {
    return this.db.query<(RPSChallenge & RowDataPacket)[]>(
      `SELECT * FROM gambling_rps_challenges WHERE status = 'accepted' AND choice_deadline < NOW()`
    );
  }

  // Timer management for choice deadlines
  startChoiceTimer(challengeId: string, callback: () => Promise<void>): void {
    this.clearChoiceTimer(challengeId);
    const timer = setTimeout(async () => {
      this.choiceTimers.delete(challengeId);
      try {
        await callback();
      } catch (error) {
        logger.error(`RPS choice timer error for ${challengeId}:`, error);
      }
    }, CHOICE_TIMEOUT_MS);
    this.choiceTimers.set(challengeId, timer);
  }

  clearChoiceTimer(challengeId: string): void {
    const timer = this.choiceTimers.get(challengeId);
    if (timer) {
      clearTimeout(timer);
      this.choiceTimers.delete(challengeId);
    }
  }

  clearAllTimers(): void {
    for (const timer of this.choiceTimers.values()) {
      clearTimeout(timer);
    }
    this.choiceTimers.clear();
  }
}
