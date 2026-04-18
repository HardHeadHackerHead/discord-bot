import { DatabaseService, RowDataPacket } from '../../../core/database/postgres.js';
import { Logger } from '../../../shared/utils/logger.js';
import { chat, getAIRegistry } from '../../../core/ai/index.js';
import { v4 as uuidv4 } from 'uuid';
import { Client, ThreadChannel, ChannelType } from 'discord.js';
import { getModuleSettingsService } from '../../../core/settings/ModuleSettingsService.js';

const logger = new Logger('Ideas');

// Reaction emojis for AI features
export const AI_REACTIONS = {
  SUMMARIZE: '📝',
  EXPAND: '💡',
  ISSUES: '⚠️',
} as const;

// Reaction emojis for voting
export const VOTE_REACTIONS = {
  UP: '✅',
  DOWN: '❌',
} as const;

export type IdeaStatus = 'pending' | 'submitted' | 'under_review' | 'approved' | 'rejected' | 'in_progress' | 'implemented';
export type SuggestionStatus = 'pending' | 'approved' | 'rejected';
export type VoteType = 'up' | 'down';
export type AIFeature = 'summarize' | 'expand' | 'issues' | 'extract';

// Status display info for the approval workflow
export const IDEA_STATUS_INFO: Record<IdeaStatus, { label: string; emoji: string; color: number; description: string }> = {
  pending: { label: 'Draft', emoji: '📝', color: 0x5865F2, description: 'Still being drafted' },
  submitted: { label: 'Submitted', emoji: '📬', color: 0x5865F2, description: 'Awaiting review' },
  under_review: { label: 'Under Review', emoji: '👀', color: 0xFEE75C, description: 'Being reviewed by admins' },
  approved: { label: 'Approved', emoji: '✅', color: 0x57F287, description: 'Approved for implementation' },
  rejected: { label: 'Rejected', emoji: '❌', color: 0xED4245, description: 'Not moving forward' },
  in_progress: { label: 'In Progress', emoji: '🔨', color: 0xEB459E, description: 'Currently being worked on' },
  implemented: { label: 'Implemented', emoji: '🎉', color: 0x57F287, description: 'Done!' },
};

export interface Idea {
  id: string;
  guild_id: string;
  channel_id: string;
  thread_id: string;
  message_id: string;
  bot_message_id: string | null;
  bot_message_id_2: string | null;
  author_id: string;
  title: string;
  content: string;
  status: IdeaStatus;
  approved_by: string | null;
  approved_at: Date | null;
  implemented_at: Date | null;
  status_changed_by: string | null;
  status_changed_at: Date | null;
  admin_notes: string | null;
  ai_summary: string | null;
  ai_summarize_cache: string | null;
  ai_expand_cache: string | null;
  ai_issues_cache: string | null;
  ai_cache_updated_at: Date | null;
  last_suggestion_approved_at: Date | null;
  tokens_used: number;
  tokens_max: number;
  tokens_reset_at: Date | null;
  current_suggestion_index: number;
  is_finalized: boolean;
  draft_summary: string | null;
  voting_suggestion_id: string | null;
  vote_announcement_message_id: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface Suggestion {
  id: string;
  idea_id: string;
  message_id: string;
  author_id: string;
  content: string;
  upvotes: number;
  downvotes: number;
  is_incorporated: boolean;
  status: SuggestionStatus;
  approved_by: string | null;
  approved_at: Date | null;
  is_voting_active: boolean;
  vote_announcement_message_id: string | null;
  created_at: Date;
}

export interface ExtractedSuggestion {
  content: string;
  sourceMessageId: string;
  authorId: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface IdeasConfig {
  guild_id: string;
  forum_channel_id: string | null;
  vote_threshold: number;
  auto_track_suggestions: boolean;
}

export class IdeasService {
  constructor(private db: DatabaseService) {}

  // ==================== Configuration ====================

  async getConfig(guildId: string): Promise<IdeasConfig | null> {
    const rows = await this.db.query<RowDataPacket[]>(
      'SELECT * FROM ideas_config WHERE guild_id = ?',
      [guildId]
    );
    return (rows[0] as IdeasConfig) || null;
  }

  async setConfig(
    guildId: string,
    forumChannelId: string | null,
    voteThreshold?: number,
    autoTrackSuggestions?: boolean
  ): Promise<void> {
    await this.db.execute(
      `INSERT INTO ideas_config (guild_id, forum_channel_id, vote_threshold, auto_track_suggestions)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (guild_id) DO UPDATE SET
         forum_channel_id = EXCLUDED.forum_channel_id,
         vote_threshold = COALESCE(EXCLUDED.vote_threshold, ideas_config.vote_threshold),
         auto_track_suggestions = COALESCE(EXCLUDED.auto_track_suggestions, ideas_config.auto_track_suggestions),
         updated_at = CURRENT_TIMESTAMP`,
      [guildId, forumChannelId, voteThreshold ?? 5, autoTrackSuggestions ?? true]
    );
    logger.info(`Updated ideas config for guild ${guildId}`);
  }

  async getForumChannelId(guildId: string): Promise<string | null> {
    // First try to get from centralized settings service
    const settingsService = getModuleSettingsService();
    if (settingsService) {
      try {
        const settings = await settingsService.getSettings<{ forum_channel_id?: string | null }>(
          'ideas',
          guildId
        );
        const forumChannelId = settings.forum_channel_id;
        if (forumChannelId) {
          logger.debug(`Got forum channel from settings service: ${forumChannelId}`);
          return forumChannelId;
        }
      } catch (error) {
        logger.debug('Could not get forum channel from settings service:', error);
      }
    }

    // Fallback to ideas_config table
    const config = await this.getConfig(guildId);
    logger.debug(`Got forum channel from config table: ${config?.forum_channel_id}`);
    return config?.forum_channel_id || null;
  }

  // ==================== Ideas CRUD ====================

  async createIdea(
    guildId: string,
    channelId: string,
    threadId: string,
    messageId: string,
    authorId: string,
    title: string,
    content: string
  ): Promise<Idea> {
    const id = uuidv4();

    await this.db.execute(
      `INSERT INTO ideas_ideas
       (id, guild_id, channel_id, thread_id, message_id, author_id, title, content)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, guildId, channelId, threadId, messageId, authorId, title, content]
    );

    logger.info(`Created idea ${id}: "${title}" by ${authorId}`);

    return {
      id,
      guild_id: guildId,
      channel_id: channelId,
      thread_id: threadId,
      message_id: messageId,
      bot_message_id: null,
      bot_message_id_2: null,
      author_id: authorId,
      title,
      content,
      status: 'pending',
      approved_by: null,
      approved_at: null,
      implemented_at: null,
      ai_summary: null,
      ai_summarize_cache: null,
      ai_expand_cache: null,
      ai_issues_cache: null,
      ai_cache_updated_at: null,
      last_suggestion_approved_at: null,
      tokens_used: 0,
      tokens_max: 3,
      tokens_reset_at: null,
      current_suggestion_index: 0,
      is_finalized: false,
      draft_summary: null,
      voting_suggestion_id: null,
      vote_announcement_message_id: null,
      status_changed_by: null,
      status_changed_at: null,
      admin_notes: null,
      created_at: new Date(),
      updated_at: new Date(),
    };
  }

  // ==================== Bot Message Tracking ====================

  async setBotMessageId(ideaId: string, messageId: string): Promise<void> {
    await this.db.execute(
      'UPDATE ideas_ideas SET bot_message_id = ? WHERE id = ?',
      [messageId, ideaId]
    );
    logger.debug(`Set bot message ID ${messageId} for idea ${ideaId}`);
  }

  async getBotMessageId(ideaId: string): Promise<string | null> {
    const idea = await this.getIdea(ideaId);
    return idea?.bot_message_id || null;
  }

  async setBotMessageId2(ideaId: string, messageId: string): Promise<void> {
    await this.db.execute(
      'UPDATE ideas_ideas SET bot_message_id_2 = ? WHERE id = ?',
      [messageId, ideaId]
    );
    logger.debug(`Set bot message 2 ID ${messageId} for idea ${ideaId}`);
  }

  async getBotMessageId2(ideaId: string): Promise<string | null> {
    const idea = await this.getIdea(ideaId);
    return idea?.bot_message_id_2 || null;
  }

  // ==================== Suggestion Navigation ====================

  async getCurrentSuggestionIndex(ideaId: string): Promise<number> {
    const idea = await this.getIdea(ideaId);
    return idea?.current_suggestion_index || 0;
  }

  async setCurrentSuggestionIndex(ideaId: string, index: number): Promise<void> {
    await this.db.execute(
      'UPDATE ideas_ideas SET current_suggestion_index = ? WHERE id = ?',
      [index, ideaId]
    );
    logger.debug(`Set suggestion index to ${index} for idea ${ideaId}`);
  }

  // ==================== Finalization ====================

  async finalizeIdea(ideaId: string): Promise<Idea | null> {
    await this.db.execute(
      'UPDATE ideas_ideas SET is_finalized = TRUE, status = ? WHERE id = ?',
      ['submitted', ideaId]
    );
    logger.info(`Finalized idea ${ideaId} - status set to submitted`);
    return this.getIdea(ideaId);
  }

  async isIdeaFinalized(ideaId: string): Promise<boolean> {
    const idea = await this.getIdea(ideaId);
    return idea?.is_finalized || false;
  }

  // ==================== Status Management ====================

  async setIdeaStatus(ideaId: string, status: IdeaStatus, changedBy: string, notes?: string): Promise<Idea | null> {
    const updateFields = ['status = ?', 'status_changed_by = ?', 'status_changed_at = CURRENT_TIMESTAMP'];
    const params: (string | null)[] = [status, changedBy];

    if (notes !== undefined) {
      updateFields.push('admin_notes = ?');
      params.push(notes);
    }

    // Set approved_at when status becomes approved
    if (status === 'approved') {
      updateFields.push('approved_by = ?', 'approved_at = CURRENT_TIMESTAMP');
      params.push(changedBy);
    }

    // Set implemented_at when status becomes implemented
    if (status === 'implemented') {
      updateFields.push('implemented_at = CURRENT_TIMESTAMP');
    }

    params.push(ideaId);

    await this.db.execute(
      `UPDATE ideas_ideas SET ${updateFields.join(', ')} WHERE id = ?`,
      params
    );
    logger.info(`Set idea ${ideaId} status to ${status} by ${changedBy}`);
    return this.getIdea(ideaId);
  }

  async getIdeaStatus(ideaId: string): Promise<IdeaStatus | null> {
    const idea = await this.getIdea(ideaId);
    return idea?.status || null;
  }

  // ==================== Draft Management ====================

  async setDraftSummary(ideaId: string, summary: string): Promise<void> {
    await this.db.execute(
      'UPDATE ideas_ideas SET draft_summary = ? WHERE id = ?',
      [summary, ideaId]
    );
    logger.debug(`Updated draft summary for idea ${ideaId}`);
  }

  async getDraftSummary(ideaId: string): Promise<string | null> {
    const idea = await this.getIdea(ideaId);
    return idea?.draft_summary || null;
  }

  /**
   * Generate a concise draft summary using AI
   * Incorporates the original idea and approved suggestions
   */
  async generateDraftSummary(ideaId: string): Promise<string> {
    const idea = await this.getIdea(ideaId);
    if (!idea) throw new Error('Idea not found');

    const approvedSuggestions = await this.getApprovedSuggestionsForIdea(ideaId);

    let prompt = `Original Idea Title: ${idea.title}\n\nOriginal Content:\n${idea.content}`;

    if (approvedSuggestions.length > 0) {
      prompt += '\n\nApproved Community Suggestions:\n';
      for (const s of approvedSuggestions) {
        prompt += `• ${s.content}\n`;
      }
    }

    const response = await chat(prompt, {
      systemPrompt: `You are helping an idea author prepare a final draft proposal.

Create a CONCISE summary (max 300 words) that:
1. States the main idea clearly in 1-2 sentences
2. Lists key points as bullet points
3. Incorporates approved suggestions naturally

Format:
**Summary:** [1-2 sentence overview]

**Key Points:**
• [point 1]
• [point 2]
...

Keep it brief and actionable. No fluff or unnecessary explanation.`,
      maxTokens: 500,
      temperature: 0.3,
    });

    // Save the draft summary
    await this.setDraftSummary(ideaId, response.text);

    return response.text;
  }

  // ==================== Voting Management ====================

  /**
   * @deprecated Use startVoteOnSuggestion instead for multi-vote support
   */
  async setVotingSuggestion(ideaId: string, suggestionId: string | null): Promise<void> {
    await this.db.execute(
      'UPDATE ideas_ideas SET voting_suggestion_id = ? WHERE id = ?',
      [suggestionId, ideaId]
    );
    logger.debug(`Set voting suggestion to ${suggestionId} for idea ${ideaId}`);
  }

  /**
   * @deprecated Use getActiveVotesForIdea instead for multi-vote support
   */
  async getVotingSuggestion(ideaId: string): Promise<string | null> {
    const idea = await this.getIdea(ideaId);
    return idea?.voting_suggestion_id || null;
  }

  // ==================== Multi-Vote Support ====================

  /**
   * Start voting on a suggestion (multi-vote support)
   */
  async startVoteOnSuggestion(suggestionId: string, announcementMessageId: string): Promise<void> {
    await this.db.execute(
      'UPDATE ideas_suggestions SET is_voting_active = TRUE, vote_announcement_message_id = ? WHERE id = ?',
      [announcementMessageId, suggestionId]
    );
    logger.debug(`Started voting on suggestion ${suggestionId}`);
  }

  /**
   * End voting on a suggestion (multi-vote support)
   */
  async endVoteOnSuggestion(suggestionId: string): Promise<void> {
    await this.db.execute(
      'UPDATE ideas_suggestions SET is_voting_active = FALSE, vote_announcement_message_id = NULL WHERE id = ?',
      [suggestionId]
    );
    logger.debug(`Ended voting on suggestion ${suggestionId}`);
  }

  /**
   * Get all suggestions with active votes for an idea
   */
  async getActiveVotesForIdea(ideaId: string): Promise<Suggestion[]> {
    const rows = await this.db.query<RowDataPacket[]>(
      'SELECT * FROM ideas_suggestions WHERE idea_id = ? AND is_voting_active = TRUE ORDER BY created_at ASC',
      [ideaId]
    );
    return rows as Suggestion[];
  }

  /**
   * Check if a suggestion has an active vote
   */
  async isSuggestionVotingActive(suggestionId: string): Promise<boolean> {
    const suggestion = await this.getSuggestion(suggestionId);
    return suggestion?.is_voting_active || false;
  }

  async isVotingEnabled(ideaId: string): Promise<boolean> {
    const suggestion = await this.getVotingSuggestion(ideaId);
    return suggestion !== null;
  }

  async setVoteAnnouncementMessageId(ideaId: string, messageId: string | null): Promise<void> {
    await this.db.execute(
      'UPDATE ideas_ideas SET vote_announcement_message_id = ? WHERE id = ?',
      [messageId, ideaId]
    );
    logger.debug(`Set vote announcement message ID to ${messageId} for idea ${ideaId}`);
  }

  async getVoteAnnouncementMessageId(ideaId: string): Promise<string | null> {
    const idea = await this.getIdea(ideaId);
    return idea?.vote_announcement_message_id || null;
  }

  async getIdea(ideaId: string): Promise<Idea | null> {
    const rows = await this.db.query<RowDataPacket[]>(
      'SELECT * FROM ideas_ideas WHERE id = ?',
      [ideaId]
    );
    return (rows[0] as Idea) || null;
  }

  async getIdeaByThread(threadId: string): Promise<Idea | null> {
    const rows = await this.db.query<RowDataPacket[]>(
      'SELECT * FROM ideas_ideas WHERE thread_id = ?',
      [threadId]
    );
    return (rows[0] as Idea) || null;
  }

  async getIdeasByGuild(
    guildId: string,
    status?: IdeaStatus,
    limit: number = 25,
    offset: number = 0
  ): Promise<Idea[]> {
    const safeLimit = Math.max(1, Math.min(100, limit));
    const safeOffset = Math.max(0, offset);

    let query = 'SELECT * FROM ideas_ideas WHERE guild_id = ?';
    const params: (string | number)[] = [guildId];

    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }

    query += ` ORDER BY created_at DESC LIMIT ${safeLimit} OFFSET ${safeOffset}`;

    const rows = await this.db.query<RowDataPacket[]>(query, params);
    return rows as Idea[];
  }

  async getIdeasCount(guildId: string, status?: IdeaStatus): Promise<number> {
    let query = 'SELECT COUNT(*) as count FROM ideas_ideas WHERE guild_id = ?';
    const params: string[] = [guildId];

    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }

    const rows = await this.db.query<RowDataPacket[]>(query, params);
    return rows[0]?.['count'] || 0;
  }

  async updateStatus(
    ideaId: string,
    status: IdeaStatus,
    adminId?: string
  ): Promise<Idea | null> {
    let query = 'UPDATE ideas_ideas SET status = ?';
    const params: (string | null)[] = [status];

    if (status === 'approved') {
      query += ', approved_by = ?, approved_at = CURRENT_TIMESTAMP';
      params.push(adminId || null);
    } else if (status === 'implemented') {
      query += ', implemented_at = CURRENT_TIMESTAMP';
    }

    query += ' WHERE id = ?';
    params.push(ideaId);

    await this.db.execute(query, params);
    logger.info(`Updated idea ${ideaId} status to ${status}`);

    return this.getIdea(ideaId);
  }

  async updateAISummary(ideaId: string, summary: string): Promise<void> {
    await this.db.execute(
      'UPDATE ideas_ideas SET ai_summary = ? WHERE id = ?',
      [summary, ideaId]
    );
  }

  // ==================== Suggestions CRUD ====================

  async createSuggestion(
    ideaId: string,
    messageId: string,
    authorId: string,
    content: string
  ): Promise<Suggestion> {
    const id = uuidv4();

    await this.db.execute(
      `INSERT INTO ideas_suggestions (id, idea_id, message_id, author_id, content)
       VALUES (?, ?, ?, ?, ?)`,
      [id, ideaId, messageId, authorId, content]
    );

    logger.debug(`Created suggestion ${id} for idea ${ideaId}`);

    return {
      id,
      idea_id: ideaId,
      message_id: messageId,
      author_id: authorId,
      content,
      upvotes: 0,
      downvotes: 0,
      is_incorporated: false,
      status: 'pending' as SuggestionStatus,
      approved_by: null,
      approved_at: null,
      is_voting_active: false,
      vote_announcement_message_id: null,
      created_at: new Date(),
    };
  }

  async approveSuggestion(suggestionId: string, adminId: string): Promise<Suggestion | null> {
    const suggestion = await this.getSuggestion(suggestionId);
    if (!suggestion) return null;

    await this.db.execute(
      `UPDATE ideas_suggestions
       SET status = 'approved', approved_by = ?, approved_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [adminId, suggestionId]
    );

    // Update the idea's last_suggestion_approved_at to invalidate cache
    await this.db.execute(
      'UPDATE ideas_ideas SET last_suggestion_approved_at = CURRENT_TIMESTAMP WHERE id = ?',
      [suggestion.idea_id]
    );

    logger.info(`Suggestion ${suggestionId} approved by ${adminId}`);
    return this.getSuggestion(suggestionId);
  }

  async rejectSuggestion(suggestionId: string, adminId: string): Promise<Suggestion | null> {
    await this.db.execute(
      `UPDATE ideas_suggestions
       SET status = 'rejected', approved_by = ?, approved_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [adminId, suggestionId]
    );
    logger.info(`Suggestion ${suggestionId} rejected by ${adminId}`);
    return this.getSuggestion(suggestionId);
  }

  /**
   * Get only approved suggestions for an idea (for AI analysis)
   */
  async getApprovedSuggestionsForIdea(ideaId: string): Promise<Suggestion[]> {
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT * FROM ideas_suggestions
       WHERE idea_id = ? AND status = 'approved'
       ORDER BY (upvotes - downvotes) DESC, upvotes DESC, created_at ASC`,
      [ideaId]
    );
    return rows as Suggestion[];
  }

  /**
   * Get pending suggestions that need admin review
   */
  async getPendingSuggestionsForIdea(ideaId: string): Promise<Suggestion[]> {
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT * FROM ideas_suggestions
       WHERE idea_id = ? AND status = 'pending'
       ORDER BY created_at ASC`,
      [ideaId]
    );
    return rows as Suggestion[];
  }

  async getSuggestion(suggestionId: string): Promise<Suggestion | null> {
    const rows = await this.db.query<RowDataPacket[]>(
      'SELECT * FROM ideas_suggestions WHERE id = ?',
      [suggestionId]
    );
    return (rows[0] as Suggestion) || null;
  }

  async getSuggestionByMessage(messageId: string): Promise<Suggestion | null> {
    const rows = await this.db.query<RowDataPacket[]>(
      'SELECT * FROM ideas_suggestions WHERE message_id = ?',
      [messageId]
    );
    return (rows[0] as Suggestion) || null;
  }

  async getSuggestionsForIdea(ideaId: string): Promise<Suggestion[]> {
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT * FROM ideas_suggestions
       WHERE idea_id = ?
       ORDER BY upvotes DESC, created_at ASC`,
      [ideaId]
    );
    return rows as Suggestion[];
  }

  /**
   * Get suggestions that have at least one vote (for AI analysis)
   * Suggestions without votes are not included in summaries
   */
  async getVotedSuggestionsForIdea(ideaId: string): Promise<Suggestion[]> {
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT * FROM ideas_suggestions
       WHERE idea_id = ? AND (upvotes > 0 OR downvotes > 0)
       ORDER BY (upvotes - downvotes) DESC, upvotes DESC, created_at ASC`,
      [ideaId]
    );
    return rows as Suggestion[];
  }

  async incorporateSuggestion(suggestionId: string): Promise<void> {
    await this.db.execute(
      'UPDATE ideas_suggestions SET is_incorporated = TRUE WHERE id = ?',
      [suggestionId]
    );
    logger.info(`Marked suggestion ${suggestionId} as incorporated`);
  }

  // ==================== Voting ====================

  async vote(
    suggestionId: string,
    userId: string,
    voteType: VoteType
  ): Promise<{ action: 'added' | 'changed' | 'removed'; upvotes: number; downvotes: number }> {
    // Check existing vote
    const existingRows = await this.db.query<RowDataPacket[]>(
      'SELECT vote_type FROM ideas_votes WHERE suggestion_id = ? AND user_id = ?',
      [suggestionId, userId]
    );
    const existingVote = existingRows[0]?.['vote_type'] as VoteType | undefined;

    let action: 'added' | 'changed' | 'removed';

    if (existingVote === voteType) {
      // Same vote - remove it (toggle off)
      await this.db.execute(
        'DELETE FROM ideas_votes WHERE suggestion_id = ? AND user_id = ?',
        [suggestionId, userId]
      );
      action = 'removed';
    } else if (existingVote) {
      // Different vote - update it
      await this.db.execute(
        'UPDATE ideas_votes SET vote_type = ? WHERE suggestion_id = ? AND user_id = ?',
        [voteType, suggestionId, userId]
      );
      action = 'changed';
    } else {
      // No existing vote - add it
      await this.db.execute(
        'INSERT INTO ideas_votes (suggestion_id, user_id, vote_type) VALUES (?, ?, ?)',
        [suggestionId, userId, voteType]
      );
      action = 'added';
    }

    // Recalculate vote counts
    await this.recalculateVotes(suggestionId);

    // Get updated counts
    const suggestion = await this.getSuggestion(suggestionId);

    return {
      action,
      upvotes: suggestion?.upvotes || 0,
      downvotes: suggestion?.downvotes || 0,
    };
  }

  private async recalculateVotes(suggestionId: string): Promise<void> {
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT
         SUM(CASE WHEN vote_type = 'up' THEN 1 ELSE 0 END) as upvotes,
         SUM(CASE WHEN vote_type = 'down' THEN 1 ELSE 0 END) as downvotes
       FROM ideas_votes WHERE suggestion_id = ?`,
      [suggestionId]
    );

    const upvotes = rows[0]?.['upvotes'] || 0;
    const downvotes = rows[0]?.['downvotes'] || 0;

    await this.db.execute(
      'UPDATE ideas_suggestions SET upvotes = ?, downvotes = ? WHERE id = ?',
      [upvotes, downvotes, suggestionId]
    );
  }

  async getUserVote(suggestionId: string, userId: string): Promise<VoteType | null> {
    const rows = await this.db.query<RowDataPacket[]>(
      'SELECT vote_type FROM ideas_votes WHERE suggestion_id = ? AND user_id = ?',
      [suggestionId, userId]
    );
    return (rows[0]?.['vote_type'] as VoteType) || null;
  }

  // ==================== Token System ====================

  /**
   * Check if an idea has tokens available for AI features
   */
  async hasTokensAvailable(ideaId: string): Promise<boolean> {
    const idea = await this.getIdea(ideaId);
    if (!idea) return false;
    return idea.tokens_used < idea.tokens_max;
  }

  /**
   * Get remaining tokens for an idea
   */
  async getTokensRemaining(ideaId: string): Promise<{ used: number; max: number; remaining: number }> {
    const idea = await this.getIdea(ideaId);
    if (!idea) return { used: 0, max: 3, remaining: 3 };
    return {
      used: idea.tokens_used,
      max: idea.tokens_max,
      remaining: Math.max(0, idea.tokens_max - idea.tokens_used),
    };
  }

  /**
   * Use a token for AI features
   */
  async useToken(ideaId: string): Promise<boolean> {
    const idea = await this.getIdea(ideaId);
    if (!idea) return false;
    if (idea.tokens_used >= idea.tokens_max) return false;

    await this.db.execute(
      'UPDATE ideas_ideas SET tokens_used = tokens_used + 1 WHERE id = ?',
      [ideaId]
    );
    logger.debug(`Used token for idea ${ideaId} (${idea.tokens_used + 1}/${idea.tokens_max})`);
    return true;
  }

  /**
   * Reset tokens for all ideas in a guild (called by cron job)
   */
  async resetTokensForGuild(guildId: string): Promise<number> {
    const result = await this.db.execute(
      `UPDATE ideas_ideas
       SET tokens_used = 0, tokens_reset_at = CURRENT_TIMESTAMP
       WHERE guild_id = ? AND status = 'pending'`,
      [guildId]
    );
    const affectedRows = result.affectedRows || 0;
    logger.info(`Reset tokens for ${affectedRows} ideas in guild ${guildId}`);
    return affectedRows;
  }

  /**
   * Reset tokens for all pending ideas across all guilds
   */
  async resetAllTokens(): Promise<number> {
    const result = await this.db.execute(
      `UPDATE ideas_ideas
       SET tokens_used = 0, tokens_reset_at = CURRENT_TIMESTAMP
       WHERE status = 'pending'`
    );
    const affectedRows = result.affectedRows || 0;
    logger.info(`Reset tokens for ${affectedRows} ideas globally`);
    return affectedRows;
  }

  // ==================== AI Caching ====================

  /**
   * Check if we have a valid cached AI result
   * Cache is invalid if:
   * - No cache exists
   * - Suggestions have been approved since cache was updated
   */
  isCacheValid(idea: Idea, feature: AIFeature): boolean {
    const cacheField = `ai_${feature}_cache` as keyof Idea;
    const cachedResult = idea[cacheField];

    if (!cachedResult) return false;
    if (!idea.ai_cache_updated_at) return false;

    // If suggestions were approved after cache was created, invalidate
    if (idea.last_suggestion_approved_at) {
      const cacheTime = new Date(idea.ai_cache_updated_at).getTime();
      const approvalTime = new Date(idea.last_suggestion_approved_at).getTime();
      if (approvalTime > cacheTime) return false;
    }

    return true;
  }

  /**
   * Get cached AI result if valid
   */
  getCachedResult(idea: Idea, feature: AIFeature): string | null {
    if (!this.isCacheValid(idea, feature)) return null;
    const cacheField = `ai_${feature}_cache` as keyof Idea;
    return idea[cacheField] as string | null;
  }

  /**
   * Save AI result to cache
   */
  async cacheAIResult(ideaId: string, feature: AIFeature, result: string): Promise<void> {
    const cacheField = `ai_${feature}_cache`;
    await this.db.execute(
      `UPDATE ideas_ideas SET ${cacheField} = ?, ai_cache_updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [result, ideaId]
    );
    logger.debug(`Cached ${feature} result for idea ${ideaId}`);
  }

  // ==================== AI Features ====================

  /**
   * Build context string for AI from idea and approved suggestions
   */
  private async buildAIContext(idea: Idea): Promise<string> {
    const approvedSuggestions = await this.getApprovedSuggestionsForIdea(idea.id);

    let context = `**Original Idea:**\n${idea.title}\n\n${idea.content}`;

    if (approvedSuggestions.length > 0) {
      context += '\n\n**Approved Community Suggestions:**\n';
      for (const s of approvedSuggestions) {
        const netVotes = s.upvotes - s.downvotes;
        const voteIndicator = netVotes > 0 ? '👍' : netVotes < 0 ? '👎' : '➖';
        const votes = `${voteIndicator} (+${s.upvotes}/-${s.downvotes})`;
        context += `- ${s.content} ${votes}\n`;
      }
    }

    return context;
  }

  async summarizeIdea(ideaId: string, client: Client): Promise<{ text: string; cached: boolean }> {
    const idea = await this.getIdea(ideaId);
    if (!idea) throw new Error('Idea not found');

    // Check cache first
    const cached = this.getCachedResult(idea, 'summarize');
    if (cached) {
      logger.debug(`Using cached summarize result for idea ${ideaId}`);
      return { text: cached, cached: true };
    }

    // Build context from idea and approved suggestions
    let context = await this.buildAIContext(idea);

    // Also fetch recent messages from the thread for more context
    try {
      const thread = await client.channels.fetch(idea.thread_id);
      if (thread && thread.type === ChannelType.PublicThread) {
        const messages = await (thread as ThreadChannel).messages.fetch({ limit: 50 });
        const discussionMessages = messages
          .filter(m => !m.author.bot && m.id !== idea.message_id)
          .map(m => m.content)
          .reverse()
          .slice(0, 20);

        if (discussionMessages.length > 0) {
          context += '\n\n**Discussion Highlights:**\n';
          context += discussionMessages.join('\n');
        }
      }
    } catch {
      // Thread might not be accessible, continue with what we have
    }

    const response = await chat(context, {
      systemPrompt: `You are a helpful assistant summarizing community ideas and feedback for a Discord server.
Provide a concise summary that includes:
1. The core idea/proposal
2. Key points from the discussion
3. Approved community suggestions
4. Any concerns raised

Keep the summary under 500 words and use bullet points for clarity.`,
      maxTokens: 1000,
      temperature: 0.3,
    });

    // Save to cache and legacy summary field
    await this.cacheAIResult(ideaId, 'summarize', response.text);
    await this.updateAISummary(ideaId, response.text);

    return { text: response.text, cached: false };
  }

  async expandIdea(ideaId: string): Promise<{ text: string; cached: boolean }> {
    const idea = await this.getIdea(ideaId);
    if (!idea) throw new Error('Idea not found');

    // Check cache first
    const cached = this.getCachedResult(idea, 'expand');
    if (cached) {
      logger.debug(`Using cached expand result for idea ${ideaId}`);
      return { text: cached, cached: true };
    }

    const context = await this.buildAIContext(idea);
    const prompt = `Please expand on this idea with more details and considerations:\n\n${context}`;

    const response = await chat(prompt, {
      systemPrompt: `You are a helpful assistant helping to develop and expand on community ideas for a Discord server.
Provide thoughtful elaboration including:
1. Potential implementation approaches
2. Benefits and use cases
3. Technical or practical considerations
4. Possible variations or enhancements

If approved community suggestions are provided, incorporate them into your expansion.
Be constructive and encouraging while being realistic about challenges.
Keep the response under 600 words.`,
      maxTokens: 1200,
      temperature: 0.7,
    });

    // Save to cache
    await this.cacheAIResult(ideaId, 'expand', response.text);

    return { text: response.text, cached: false };
  }

  async findIssues(ideaId: string): Promise<{ text: string; cached: boolean }> {
    const idea = await this.getIdea(ideaId);
    if (!idea) throw new Error('Idea not found');

    // Check cache first
    const cached = this.getCachedResult(idea, 'issues');
    if (cached) {
      logger.debug(`Using cached issues result for idea ${ideaId}`);
      return { text: cached, cached: true };
    }

    const context = await this.buildAIContext(idea);

    const response = await chat(context, {
      systemPrompt: `You are a constructive critic helping to identify potential issues and challenges with community ideas.
Analyze the idea and any approved suggestions, then provide:
1. Potential problems or challenges
2. Edge cases to consider
3. Resource or technical requirements
4. Questions that need to be answered

Be constructive - the goal is to help improve the idea, not discourage it.
Present issues as considerations to address, not reasons to abandon the idea.
Keep the response under 500 words.`,
      maxTokens: 1000,
      temperature: 0.5,
    });

    // Save to cache
    await this.cacheAIResult(ideaId, 'issues', response.text);

    return { text: response.text, cached: false };
  }

  hasAIProvider(): boolean {
    return getAIRegistry().hasConfiguredProvider();
  }

  /**
   * Extract actionable suggestions from thread messages using AI
   * Returns structured suggestions that can then be voted on
   */
  async extractSuggestions(ideaId: string, client: Client): Promise<ExtractedSuggestion[]> {
    const idea = await this.getIdea(ideaId);
    if (!idea) throw new Error('Idea not found');

    // Fetch messages from the thread
    let messages: Array<{ id: string; authorId: string; content: string }> = [];
    try {
      const thread = await client.channels.fetch(idea.thread_id);
      if (thread && thread.type === ChannelType.PublicThread) {
        const fetchedMessages = await (thread as ThreadChannel).messages.fetch({ limit: 100 });
        messages = fetchedMessages
          .filter(m => !m.author.bot && m.id !== idea.message_id && m.content.length >= 10)
          .map(m => ({
            id: m.id,
            authorId: m.author.id,
            content: m.content,
          }))
          .reverse(); // Oldest first
      }
    } catch (error) {
      logger.error('Failed to fetch thread messages for extraction:', error);
      throw new Error('Could not fetch thread messages');
    }

    if (messages.length === 0) {
      return [];
    }

    // Get already-tracked suggestion message IDs to avoid duplicates
    const existingSuggestions = await this.getSuggestionsForIdea(ideaId);
    const existingMessageIds = new Set(existingSuggestions.map(s => s.message_id));

    // Filter out already-tracked messages
    const newMessages = messages.filter(m => !existingMessageIds.has(m.id));
    if (newMessages.length === 0) {
      return [];
    }

    // Build prompt for AI
    const messagesText = newMessages
      .map((m, i) => `[${i + 1}] (msg:${m.id}) <@${m.authorId}>: ${m.content}`)
      .join('\n\n');

    const prompt = `Original Idea Title: ${idea.title}

Original Idea Content:
${idea.content}

---

Thread Replies to Analyze:
${messagesText}

---

Analyze these thread replies and extract ONLY actionable suggestions that propose specific changes, improvements, or additions to the original idea.

For each suggestion found, output in this exact JSON format:
{
  "suggestions": [
    {
      "messageIndex": 1,
      "content": "Clear, concise description of the suggestion",
      "confidence": "high|medium|low"
    }
  ]
}

Rules:
- ONLY include messages that contain actual suggestions (proposals to change/improve/add something)
- Do NOT include: questions, general comments, praise, complaints without solutions, off-topic discussion
- Rephrase suggestions to be clear and actionable (don't just copy the message)
- "high" confidence = clearly an actionable suggestion
- "medium" confidence = somewhat ambiguous but appears to be a suggestion
- "low" confidence = very uncertain, might not be a suggestion
- If a message contains multiple suggestions, list them separately
- If no actionable suggestions are found, return {"suggestions": []}`;

    const response = await chat(prompt, {
      systemPrompt: `You are an expert at identifying actionable suggestions from discussion threads.
You distinguish between actual proposals for changes/improvements and general discussion, questions, or feedback.
Always respond with valid JSON only, no additional text.`,
      maxTokens: 2000,
      temperature: 0.3,
    });

    // Parse the AI response
    try {
      // Extract JSON from response (in case there's extra text)
      const jsonMatch = response.text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        logger.warn('AI response did not contain valid JSON for extraction');
        return [];
      }

      const parsed = JSON.parse(jsonMatch[0]) as {
        suggestions: Array<{
          messageIndex: number;
          content: string;
          confidence: 'high' | 'medium' | 'low';
        }>;
      };

      if (!parsed.suggestions || !Array.isArray(parsed.suggestions)) {
        return [];
      }

      // Map back to our format with source message info
      const extracted: ExtractedSuggestion[] = [];
      for (const s of parsed.suggestions) {
        const sourceMessage = newMessages[s.messageIndex - 1]; // 1-indexed
        if (sourceMessage) {
          extracted.push({
            content: s.content,
            sourceMessageId: sourceMessage.id,
            authorId: sourceMessage.authorId,
            confidence: s.confidence,
          });
        }
      }

      logger.info(`Extracted ${extracted.length} suggestions from ${newMessages.length} messages for idea ${ideaId}`);
      return extracted;

    } catch (error) {
      logger.error('Failed to parse AI extraction response:', error);
      return [];
    }
  }

  /**
   * Create suggestion from an extracted suggestion (after admin approval)
   */
  async createSuggestionFromExtracted(
    ideaId: string,
    extracted: ExtractedSuggestion
  ): Promise<Suggestion> {
    return this.createSuggestion(
      ideaId,
      extracted.sourceMessageId,
      extracted.authorId,
      extracted.content
    );
  }

  // ==================== Thread Management ====================

  async lockThread(client: Client, threadId: string): Promise<boolean> {
    try {
      const thread = await client.channels.fetch(threadId);
      if (thread && thread.type === ChannelType.PublicThread) {
        await (thread as ThreadChannel).setLocked(true);
        await (thread as ThreadChannel).setArchived(true);
        return true;
      }
    } catch (error) {
      logger.error(`Failed to lock thread ${threadId}:`, error);
    }
    return false;
  }

  async unlockThread(client: Client, threadId: string): Promise<boolean> {
    try {
      const thread = await client.channels.fetch(threadId);
      if (thread && thread.type === ChannelType.PublicThread) {
        await (thread as ThreadChannel).setArchived(false);
        await (thread as ThreadChannel).setLocked(false);
        return true;
      }
    } catch (error) {
      logger.error(`Failed to unlock thread ${threadId}:`, error);
    }
    return false;
  }
}

// Singleton instance
let ideasService: IdeasService | null = null;

export function initIdeasService(db: DatabaseService): IdeasService {
  ideasService = new IdeasService(db);
  return ideasService;
}

export function getIdeasService(): IdeasService | null {
  return ideasService;
}
