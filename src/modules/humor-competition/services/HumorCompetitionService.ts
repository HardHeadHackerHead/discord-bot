import { randomUUID } from 'crypto';
import { DatabaseService, RowDataPacket } from '../../../core/database/postgres.js';
import { Logger } from '../../../shared/utils/logger.js';

const logger = new Logger('HumorCompetition:Service');

// ==================== Constants ====================

export const KING_ROLE_RETENTION_DAYS = 7;
export const DAILY_HOUR_ET = 3;

export const FORUM_CHANNEL_NAME = 'daily-humor';
export const TRUSTED_ROLE_NAME = 'Humor Manager';
export const WINNER_ROLE_NAME = 'King of Humor';

// ==================== Interfaces ====================

export interface GuildSettings {
  id: string;
  guild_id: string;
  forum_channel_id: string | null;
  trusted_role_id: string | null;
  winner_role_id: string | null;
  announce_channel_id: string | null;
  setup_complete: boolean;
  created_at: Date;
}

export interface ThreadIndex {
  id: string;
  guild_id: string;
  thread_id: string;
  date_label: string;
  panel_message_id: string | null;
  created_at: Date;
}

export interface Submission {
  id: string;
  thread_id: string;
  guild_id: string;
  user_id: string;
  message_id: string;
  image_url: string;
  vote_count: number;
  submitted_at: Date;
}

export interface Winner {
  id: string;
  guild_id: string;
  thread_id: string;
  user_id: string;
  submission_id: string;
  vote_count: number;
  crowned_at: Date;
}

export interface LeaderboardEntry {
  user_id: string;
  wins: number;
  total_votes: number;
}

// ==================== Helpers ====================

export function getCurrentEasternHour(): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    hour12: false,
  });
  return parseInt(formatter.format(new Date()), 10);
}

export function getTodaysDateLabel(): string {
  return new Date().toLocaleDateString('en-US', {
    timeZone: 'America/New_York',
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });
}

export function getThreadName(dateLabel: string): string {
  return `🎨 ${dateLabel}`;
}

// ==================== Service ====================

export class HumorCompetitionService {
  constructor(private db: DatabaseService) {}

  // ==================== Guild Settings ====================

  async getGuildSettings(guildId: string): Promise<GuildSettings | null> {
    const rows = await this.db.query<(GuildSettings & RowDataPacket)[]>(
      'SELECT * FROM humor_guild_settings WHERE guild_id = ?',
      [guildId]
    );
    return rows[0] || null;
  }

  async ensureGuildSettings(guildId: string): Promise<GuildSettings> {
    let settings = await this.getGuildSettings(guildId);
    if (!settings) {
      await this.db.execute(
        'INSERT INTO humor_guild_settings (id, guild_id) VALUES (?, ?)',
        [randomUUID(), guildId]
      );
      settings = await this.getGuildSettings(guildId);
    }
    return settings!;
  }

  async saveSetupIds(
    guildId: string,
    forumChannelId: string,
    trustedRoleId: string,
    winnerRoleId: string,
    announceChannelId: string | null
  ): Promise<void> {
    await this.ensureGuildSettings(guildId);
    await this.db.execute(
      'UPDATE humor_guild_settings SET forum_channel_id = ?, trusted_role_id = ?, winner_role_id = ?, announce_channel_id = ?, setup_complete = TRUE WHERE guild_id = ?',
      [forumChannelId, trustedRoleId, winnerRoleId, announceChannelId, guildId]
    );
  }

  async setAnnounceChannel(guildId: string, channelId: string): Promise<void> {
    await this.db.execute(
      'UPDATE humor_guild_settings SET announce_channel_id = ? WHERE guild_id = ?',
      [channelId, guildId]
    );
  }

  async getAllSetupGuilds(): Promise<GuildSettings[]> {
    return this.db.query<(GuildSettings & RowDataPacket)[]>(
      'SELECT * FROM humor_guild_settings WHERE setup_complete = TRUE',
      []
    );
  }

  // ==================== Thread Index ====================

  async getThreadIndex(threadId: string): Promise<ThreadIndex | null> {
    const rows = await this.db.query<(ThreadIndex & RowDataPacket)[]>(
      'SELECT * FROM humor_thread_index WHERE thread_id = ?',
      [threadId]
    );
    return rows[0] || null;
  }

  async getThreadByDateLabel(guildId: string, dateLabel: string): Promise<ThreadIndex | null> {
    const rows = await this.db.query<(ThreadIndex & RowDataPacket)[]>(
      'SELECT * FROM humor_thread_index WHERE guild_id = ? AND date_label = ?',
      [guildId, dateLabel]
    );
    return rows[0] || null;
  }

  async saveThreadIndex(guildId: string, threadId: string, dateLabel: string): Promise<void> {
    await this.db.execute(
      'INSERT INTO humor_thread_index (id, guild_id, thread_id, date_label) VALUES (?, ?, ?, ?)',
      [randomUUID(), guildId, threadId, dateLabel]
    );
  }

  async setPanelMessageId(threadId: string, messageId: string): Promise<void> {
    await this.db.execute(
      'UPDATE humor_thread_index SET panel_message_id = ? WHERE thread_id = ?',
      [messageId, threadId]
    );
  }

  async deleteThreadIndex(threadId: string): Promise<void> {
    await this.db.execute(
      'DELETE FROM humor_thread_index WHERE thread_id = ?',
      [threadId]
    );
  }

  async getYesterdaysThread(guildId: string): Promise<ThreadIndex | null> {
    // Get yesterday's date label in Eastern time
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const label = yesterday.toLocaleDateString('en-US', {
      timeZone: 'America/New_York',
      weekday: 'long',
      month: 'short',
      day: 'numeric',
    });
    return this.getThreadByDateLabel(guildId, label);
  }

  // ==================== Submissions ====================

  async getSubmissions(threadId: string): Promise<Submission[]> {
    return this.db.query<(Submission & RowDataPacket)[]>(
      'SELECT * FROM humor_submissions WHERE thread_id = ? ORDER BY vote_count DESC, submitted_at ASC',
      [threadId]
    );
  }

  async getSubmission(submissionId: string): Promise<Submission | null> {
    const rows = await this.db.query<(Submission & RowDataPacket)[]>(
      'SELECT * FROM humor_submissions WHERE id = ?',
      [submissionId]
    );
    return rows[0] || null;
  }

  async getUserSubmission(threadId: string, userId: string): Promise<Submission | null> {
    const rows = await this.db.query<(Submission & RowDataPacket)[]>(
      'SELECT * FROM humor_submissions WHERE thread_id = ? AND user_id = ?',
      [threadId, userId]
    );
    return rows[0] || null;
  }

  async addSubmission(
    threadId: string,
    guildId: string,
    userId: string,
    messageId: string,
    imageUrl: string
  ): Promise<Submission | null> {
    const id = randomUUID();
    try {
      await this.db.execute(
        'INSERT INTO humor_submissions (id, thread_id, guild_id, user_id, message_id, image_url) VALUES (?, ?, ?, ?, ?, ?)',
        [id, threadId, guildId, userId, messageId, imageUrl]
      );
      return this.getSubmission(id);
    } catch (error: unknown) {
      // Only swallow duplicate key violations (unique constraint on thread_id + user_id)
      if (error && typeof error === 'object' && 'code' in error && error.code === '23505') {
        return null;
      }
      logger.error('Failed to add submission:', error);
      throw error;
    }
  }

  async deleteSubmission(submissionId: string): Promise<void> {
    await this.db.execute(
      'DELETE FROM humor_submissions WHERE id = ?',
      [submissionId]
    );
  }

  async updateSubmissionVoteCount(submissionId: string, voteCount: number): Promise<void> {
    await this.db.execute(
      'UPDATE humor_submissions SET vote_count = ? WHERE id = ?',
      [voteCount, submissionId]
    );
  }

  async getSubmissionCount(threadId: string): Promise<number> {
    const rows = await this.db.query<({ count: number } & RowDataPacket)[]>(
      'SELECT COUNT(*) as count FROM humor_submissions WHERE thread_id = ?',
      [threadId]
    );
    return rows[0]?.count ?? 0;
  }

  // ==================== Winners & Leaderboard ====================

  async recordWinner(
    guildId: string,
    threadId: string,
    userId: string,
    submissionId: string,
    voteCount: number
  ): Promise<void> {
    await this.db.execute(
      'INSERT INTO humor_winners (id, guild_id, thread_id, user_id, submission_id, vote_count) VALUES (?, ?, ?, ?, ?, ?)',
      [randomUUID(), guildId, threadId, userId, submissionId, voteCount]
    );
  }

  async getWinnerByThread(threadId: string): Promise<Winner | null> {
    const rows = await this.db.query<(Winner & RowDataPacket)[]>(
      'SELECT * FROM humor_winners WHERE thread_id = ?',
      [threadId]
    );
    return rows[0] || null;
  }

  async getLatestWinDate(guildId: string, userId: string): Promise<Date | null> {
    const rows = await this.db.query<({ crowned_at: Date } & RowDataPacket)[]>(
      'SELECT crowned_at FROM humor_winners WHERE guild_id = ? AND user_id = ? ORDER BY crowned_at DESC LIMIT 1',
      [guildId, userId]
    );
    return rows[0]?.crowned_at ?? null;
  }

  async getLeaderboard(guildId: string, limit: number = 10, offset: number = 0): Promise<LeaderboardEntry[]> {
    return this.db.query<(LeaderboardEntry & RowDataPacket)[]>(
      `SELECT user_id, COUNT(*) as wins, SUM(vote_count) as total_votes
       FROM humor_winners
       WHERE guild_id = ?
       GROUP BY user_id
       ORDER BY wins DESC, total_votes DESC
       LIMIT ? OFFSET ?`,
      [guildId, limit, offset]
    );
  }

  async getLeaderboardCount(guildId: string): Promise<number> {
    const rows = await this.db.query<({ count: number } & RowDataPacket)[]>(
      'SELECT COUNT(DISTINCT user_id) as count FROM humor_winners WHERE guild_id = ?',
      [guildId]
    );
    return rows[0]?.count ?? 0;
  }
}
