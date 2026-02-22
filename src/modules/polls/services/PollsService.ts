import {
  Guild,
  GuildMember,
  TextChannel,
  VoiceChannel,
  Message,
} from 'discord.js';
import { randomUUID } from 'crypto';
import { DatabaseService } from '../../../core/database/mysql.js';
import { Logger } from '../../../shared/utils/logger.js';
import { RowDataPacket } from 'mysql2';
import { PollsPanel } from '../components/PollsPanel.js';

const logger = new Logger('Polls:Service');

/** Poll types */
export type PollType = 'standard' | 'lab_ownership' | 'custom';

/** Poll status */
export type PollStatus = 'active' | 'ended' | 'cancelled';

/**
 * Poll record from database
 */
export interface Poll {
  id: string;
  guild_id: string;
  channel_id: string;
  message_id: string | null;
  creator_id: string;
  title: string;
  description: string | null;
  poll_type: PollType;
  context_id: string | null;
  status: PollStatus;
  allow_multiple: boolean;
  anonymous: boolean;
  duration_seconds: number | null;
  created_at: Date;
  ends_at: Date | null;
  ended_at: Date | null;
}

/**
 * Poll option record
 */
export interface PollOption {
  id: string;
  poll_id: string;
  label: string;
  description: string | null;
  emoji: string | null;
  value: string | null;
  position: number;
  created_at: Date;
}

/**
 * Vote record
 */
export interface Vote {
  id: string;
  poll_id: string;
  option_id: string;
  user_id: string;
  created_at: Date;
}

/**
 * Option with vote count
 */
export interface PollOptionWithVotes extends PollOption {
  vote_count: number;
  voters: string[];
}

/**
 * Poll creation options
 */
export interface CreatePollOptions {
  guildId: string;
  channelId: string;
  creatorId: string;
  title: string;
  description?: string;
  pollType?: PollType;
  contextId?: string;
  options: { label: string; description?: string; emoji?: string; value?: string }[];
  allowMultiple?: boolean;
  anonymous?: boolean;
  durationSeconds?: number;
}

/**
 * Service for managing polls
 */
export class PollsService {
  constructor(private db: DatabaseService) {}

  // ==================== Poll CRUD ====================

  /**
   * Create a new poll
   */
  async createPoll(options: CreatePollOptions): Promise<Poll | null> {
    const pollId = randomUUID();

    try {
      const endsAt = options.durationSeconds
        ? new Date(Date.now() + options.durationSeconds * 1000)
        : null;

      await this.db.execute(
        `INSERT INTO polls_polls
         (id, guild_id, channel_id, creator_id, title, description, poll_type, context_id, allow_multiple, anonymous, duration_seconds, ends_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          pollId,
          options.guildId,
          options.channelId,
          options.creatorId,
          options.title,
          options.description || null,
          options.pollType || 'standard',
          options.contextId || null,
          options.allowMultiple || false,
          options.anonymous || false,
          options.durationSeconds || null,
          endsAt,
        ]
      );

      // Create options
      for (let i = 0; i < options.options.length; i++) {
        const opt = options.options[i];
        if (!opt) continue;
        await this.db.execute(
          `INSERT INTO polls_options (id, poll_id, label, description, emoji, value, position)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            randomUUID(),
            pollId,
            opt.label,
            opt.description || null,
            opt.emoji || null,
            opt.value || null,
            i,
          ]
        );
      }

      logger.info(`Created poll "${options.title}" in guild ${options.guildId}`);

      return this.getPoll(pollId);
    } catch (error) {
      logger.error('Failed to create poll:', error);
      return null;
    }
  }

  /**
   * Get a poll by ID
   */
  async getPoll(pollId: string): Promise<Poll | null> {
    const rows = await this.db.query<(Poll & RowDataPacket)[]>(
      'SELECT * FROM polls_polls WHERE id = ?',
      [pollId]
    );
    return rows[0] || null;
  }

  /**
   * Get a poll by message ID
   */
  async getPollByMessage(messageId: string): Promise<Poll | null> {
    const rows = await this.db.query<(Poll & RowDataPacket)[]>(
      'SELECT * FROM polls_polls WHERE message_id = ?',
      [messageId]
    );
    return rows[0] || null;
  }

  /**
   * Get a poll by context ID (e.g., lab channel ID for ownership polls)
   */
  async getPollByContext(contextId: string, pollType: PollType): Promise<Poll | null> {
    const rows = await this.db.query<(Poll & RowDataPacket)[]>(
      'SELECT * FROM polls_polls WHERE context_id = ? AND poll_type = ? AND status = ?',
      [contextId, pollType, 'active']
    );
    return rows[0] || null;
  }

  /**
   * Get active polls for a guild
   */
  async getActivePolls(guildId: string): Promise<Poll[]> {
    return this.db.query<(Poll & RowDataPacket)[]>(
      'SELECT * FROM polls_polls WHERE guild_id = ? AND status = ? ORDER BY created_at DESC',
      [guildId, 'active']
    );
  }

  /**
   * Set the message ID for a poll (after sending to channel)
   */
  async setMessageId(pollId: string, messageId: string): Promise<void> {
    await this.db.execute(
      'UPDATE polls_polls SET message_id = ? WHERE id = ?',
      [messageId, pollId]
    );
  }

  /**
   * End a poll
   */
  async endPoll(pollId: string): Promise<Poll | null> {
    await this.db.execute(
      'UPDATE polls_polls SET status = ?, ended_at = NOW() WHERE id = ?',
      ['ended', pollId]
    );
    return this.getPoll(pollId);
  }

  /**
   * Cancel a poll
   */
  async cancelPoll(pollId: string): Promise<boolean> {
    const result = await this.db.execute(
      'UPDATE polls_polls SET status = ?, ended_at = NOW() WHERE id = ?',
      ['cancelled', pollId]
    );
    return result.affectedRows > 0;
  }

  // ==================== Poll Options ====================

  /**
   * Get options for a poll
   */
  async getPollOptions(pollId: string): Promise<PollOption[]> {
    return this.db.query<(PollOption & RowDataPacket)[]>(
      'SELECT * FROM polls_options WHERE poll_id = ? ORDER BY position',
      [pollId]
    );
  }

  /**
   * Get options with vote counts
   */
  async getPollOptionsWithVotes(pollId: string): Promise<PollOptionWithVotes[]> {
    const options = await this.getPollOptions(pollId);
    const votes = await this.getVotes(pollId);

    return options.map(opt => {
      const optionVotes = votes.filter(v => v.option_id === opt.id);
      return {
        ...opt,
        vote_count: optionVotes.length,
        voters: optionVotes.map(v => v.user_id),
      };
    });
  }

  /**
   * Get an option by ID
   */
  async getOption(optionId: string): Promise<PollOption | null> {
    const rows = await this.db.query<(PollOption & RowDataPacket)[]>(
      'SELECT * FROM polls_options WHERE id = ?',
      [optionId]
    );
    return rows[0] || null;
  }

  // ==================== Voting ====================

  /**
   * Cast a vote
   */
  async vote(pollId: string, optionId: string, userId: string): Promise<boolean> {
    const poll = await this.getPoll(pollId);
    if (!poll || poll.status !== 'active') {
      return false;
    }

    // Check if poll has ended by time
    if (poll.ends_at && new Date(poll.ends_at) < new Date()) {
      await this.endPoll(pollId);
      return false;
    }

    try {
      // If not allowing multiple votes, remove previous votes first
      if (!poll.allow_multiple) {
        await this.db.execute(
          'DELETE FROM polls_votes WHERE poll_id = ? AND user_id = ?',
          [pollId, userId]
        );
      }

      // Add the vote
      await this.db.execute(
        'INSERT INTO polls_votes (id, poll_id, option_id, user_id) VALUES (?, ?, ?, ?)',
        [randomUUID(), pollId, optionId, userId]
      );

      logger.debug(`User ${userId} voted for option ${optionId} in poll ${pollId}`);
      return true;
    } catch (error) {
      // Duplicate vote
      logger.debug(`User ${userId} already voted for option ${optionId}`);
      return false;
    }
  }

  /**
   * Remove a vote
   */
  async unvote(pollId: string, optionId: string, userId: string): Promise<boolean> {
    const result = await this.db.execute(
      'DELETE FROM polls_votes WHERE poll_id = ? AND option_id = ? AND user_id = ?',
      [pollId, optionId, userId]
    );
    return result.affectedRows > 0;
  }

  /**
   * Toggle a vote (vote if not voted, unvote if already voted)
   */
  async toggleVote(pollId: string, optionId: string, userId: string): Promise<{ voted: boolean } | null> {
    const poll = await this.getPoll(pollId);
    if (!poll || poll.status !== 'active') {
      return null;
    }

    // Check if already voted for this option
    const existing = await this.db.query<({ id: string } & RowDataPacket)[]>(
      'SELECT id FROM polls_votes WHERE poll_id = ? AND option_id = ? AND user_id = ?',
      [pollId, optionId, userId]
    );

    if (existing.length > 0) {
      // Unvote
      await this.unvote(pollId, optionId, userId);
      return { voted: false };
    } else {
      // Vote
      const success = await this.vote(pollId, optionId, userId);
      return success ? { voted: true } : null;
    }
  }

  /**
   * Get all votes for a poll
   */
  async getVotes(pollId: string): Promise<Vote[]> {
    return this.db.query<(Vote & RowDataPacket)[]>(
      'SELECT * FROM polls_votes WHERE poll_id = ?',
      [pollId]
    );
  }

  /**
   * Get user's votes for a poll
   */
  async getUserVotes(pollId: string, userId: string): Promise<Vote[]> {
    return this.db.query<(Vote & RowDataPacket)[]>(
      'SELECT * FROM polls_votes WHERE poll_id = ? AND user_id = ?',
      [pollId, userId]
    );
  }

  /**
   * Get total vote count for a poll
   */
  async getTotalVotes(pollId: string): Promise<number> {
    const rows = await this.db.query<({ count: number } & RowDataPacket)[]>(
      'SELECT COUNT(DISTINCT user_id) as count FROM polls_votes WHERE poll_id = ?',
      [pollId]
    );
    return rows[0]?.count ?? 0;
  }

  // ==================== Results ====================

  /**
   * Get the winning option(s) for a poll
   * Returns array in case of tie
   */
  async getWinners(pollId: string): Promise<PollOptionWithVotes[]> {
    const options = await this.getPollOptionsWithVotes(pollId);
    if (options.length === 0) return [];

    const maxVotes = Math.max(...options.map(o => o.vote_count));
    if (maxVotes === 0) return [];

    return options.filter(o => o.vote_count === maxVotes);
  }

  // ==================== Lab Ownership Polls ====================

  /**
   * Create a lab ownership transfer poll
   */
  async createLabOwnershipPoll(
    guild: Guild,
    channel: VoiceChannel,
    previousOwnerId: string,
    eligibleMembers: GuildMember[]
  ): Promise<{ poll: Poll; message: Message } | null> {
    if (eligibleMembers.length === 0) {
      logger.debug('No eligible members for lab ownership poll');
      return null;
    }

    // If only one eligible member, no need for poll
    if (eligibleMembers.length === 1) {
      logger.debug('Only one eligible member, no poll needed');
      return null;
    }

    try {
      // Create the poll
      const poll = await this.createPoll({
        guildId: guild.id,
        channelId: channel.id,
        creatorId: previousOwnerId,
        title: 'Lab Ownership Vote',
        description: 'The previous owner has left. Vote for who should become the new lab owner!',
        pollType: 'lab_ownership',
        contextId: channel.id,
        options: eligibleMembers.map(member => ({
          label: member.displayName,
          value: member.id,
          emoji: undefined,
        })),
        allowMultiple: false,
        anonymous: false,
        durationSeconds: 60, // 1 minute voting period
      });

      if (!poll) {
        logger.error('Failed to create lab ownership poll');
        return null;
      }

      // Get options for the embed
      const options = await this.getPollOptionsWithVotes(poll.id);

      // Send the poll message to the voice channel's text chat
      const embed = PollsPanel.createPollEmbed(poll, options, 0);
      const components = PollsPanel.createVoteComponents(poll, options);

      const message = await channel.send({
        embeds: [embed],
        components,
      });

      // Store the message ID
      await this.setMessageId(poll.id, message.id);

      logger.info(`Created lab ownership poll in channel ${channel.name}`);

      return { poll, message };
    } catch (error) {
      logger.error('Failed to create lab ownership poll:', error);
      return null;
    }
  }

  // ==================== Cleanup ====================

  /**
   * Check and end polls that have expired
   */
  async checkExpiredPolls(): Promise<Poll[]> {
    const expiredPolls = await this.db.query<(Poll & RowDataPacket)[]>(
      'SELECT * FROM polls_polls WHERE status = ? AND ends_at IS NOT NULL AND ends_at <= NOW()',
      ['active']
    );

    for (const poll of expiredPolls) {
      await this.endPoll(poll.id);
    }

    return expiredPolls;
  }

  /**
   * Delete old ended polls (cleanup)
   */
  async cleanupOldPolls(daysToKeep: number = 30): Promise<number> {
    const result = await this.db.execute(
      `DELETE FROM polls_polls
       WHERE status IN ('ended', 'cancelled')
       AND ended_at < DATE_SUB(NOW(), INTERVAL ? DAY)`,
      [daysToKeep]
    );
    if (result.affectedRows > 0) {
      logger.debug(`Cleaned up ${result.affectedRows} old polls`);
    }
    return result.affectedRows;
  }
}
