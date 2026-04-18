import { DatabaseService, RowDataPacket } from '../../../core/database/postgres.js';
import { Logger } from '../../../shared/utils/logger.js';
import { v4 as uuidv4 } from 'uuid';
import { chat, getAIRegistry } from '../../../core/ai/index.js';
import {
  WelcomeSettings,
  WelcomeHistoryEntry,
  WelcomeImage,
  DEFAULT_MESSAGE_TEMPLATE,
  DEFAULT_EMBED_TITLE,
  DEFAULT_EMBED_DESCRIPTION,
  DEFAULT_EMBED_COLOR,
  DEFAULT_AI_PROMPT,
} from '../types.js';

const logger = new Logger('Welcome:Service');

/**
 * Service for managing welcome settings and history
 */
export class WelcomeService {
  constructor(private db: DatabaseService) {}

  /**
   * Get welcome settings for a guild, creating defaults if not exists
   */
  async getSettings(guildId: string): Promise<WelcomeSettings> {
    const rows = await this.db.query<(WelcomeSettings & RowDataPacket)[]>(
      'SELECT * FROM welcome_guild_settings WHERE guild_id = ?',
      [guildId]
    );

    if (rows[0]) return rows[0];

    // Create default settings
    const id = uuidv4();
    await this.db.execute(
      `INSERT INTO welcome_guild_settings
       (id, guild_id, enabled, message_template, embed_title, embed_description, embed_color, ai_prompt_template)
       VALUES (?, ?, FALSE, ?, ?, ?, ?, ?)`,
      [id, guildId, DEFAULT_MESSAGE_TEMPLATE, DEFAULT_EMBED_TITLE, DEFAULT_EMBED_DESCRIPTION, DEFAULT_EMBED_COLOR, DEFAULT_AI_PROMPT]
    );

    return {
      id,
      guild_id: guildId,
      enabled: false,
      welcome_channel_id: null,
      send_dm: false,
      message_template: DEFAULT_MESSAGE_TEMPLATE,
      embed_title: DEFAULT_EMBED_TITLE,
      embed_description: DEFAULT_EMBED_DESCRIPTION,
      embed_color: DEFAULT_EMBED_COLOR,
      include_image: true,
      mention_user: true,
      use_ai_message: false,
      ai_prompt_template: DEFAULT_AI_PROMPT,
      use_ai_image: false,
      ai_image_prompt: null,
      created_at: new Date(),
      updated_at: new Date(),
    };
  }

  /**
   * Update welcome settings for a guild
   */
  async updateSettings(guildId: string, updates: Partial<WelcomeSettings>): Promise<void> {
    // Ensure settings exist
    await this.getSettings(guildId);

    const fields: string[] = [];
    const values: unknown[] = [];

    if (updates.enabled !== undefined) {
      fields.push('enabled = ?');
      values.push(updates.enabled);
    }
    if (updates.welcome_channel_id !== undefined) {
      fields.push('welcome_channel_id = ?');
      values.push(updates.welcome_channel_id);
    }
    if (updates.send_dm !== undefined) {
      fields.push('send_dm = ?');
      values.push(updates.send_dm);
    }
    if (updates.message_template !== undefined) {
      fields.push('message_template = ?');
      values.push(updates.message_template);
    }
    if (updates.embed_title !== undefined) {
      fields.push('embed_title = ?');
      values.push(updates.embed_title);
    }
    if (updates.embed_description !== undefined) {
      fields.push('embed_description = ?');
      values.push(updates.embed_description);
    }
    if (updates.embed_color !== undefined) {
      fields.push('embed_color = ?');
      values.push(updates.embed_color);
    }
    if (updates.include_image !== undefined) {
      fields.push('include_image = ?');
      values.push(updates.include_image);
    }
    if (updates.mention_user !== undefined) {
      fields.push('mention_user = ?');
      values.push(updates.mention_user);
    }
    if (updates.use_ai_message !== undefined) {
      fields.push('use_ai_message = ?');
      values.push(updates.use_ai_message);
    }
    if (updates.ai_prompt_template !== undefined) {
      fields.push('ai_prompt_template = ?');
      values.push(updates.ai_prompt_template);
    }
    if (updates.use_ai_image !== undefined) {
      fields.push('use_ai_image = ?');
      values.push(updates.use_ai_image);
    }
    if (updates.ai_image_prompt !== undefined) {
      fields.push('ai_image_prompt = ?');
      values.push(updates.ai_image_prompt);
    }

    if (fields.length === 0) return;

    fields.push('updated_at = NOW()');
    values.push(guildId);

    await this.db.execute(
      `UPDATE welcome_guild_settings SET ${fields.join(', ')} WHERE guild_id = ?`,
      values
    );

    logger.debug(`Updated welcome settings for guild ${guildId}`);
  }

  /**
   * Log a welcome message to history
   */
  async logWelcome(entry: Omit<WelcomeHistoryEntry, 'id' | 'created_at'>): Promise<void> {
    const id = uuidv4();
    await this.db.execute(
      `INSERT INTO welcome_history
       (id, guild_id, user_id, channel_id, message_id, sent_dm, image_generated, image_id, image_path, image_prompt_index, image_prompt_text, image_model, image_cost, ai_message_generated, ai_tokens_used, error_message)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        entry.guild_id,
        entry.user_id,
        entry.channel_id,
        entry.message_id,
        entry.sent_dm,
        entry.image_generated,
        entry.image_id,
        entry.image_path,
        entry.image_prompt_index,
        entry.image_prompt_text,
        entry.image_model,
        entry.image_cost,
        entry.ai_message_generated,
        entry.ai_tokens_used,
        entry.error_message,
      ]
    );
  }

  /**
   * Get recent welcome history for a guild
   */
  async getRecentWelcomes(guildId: string, limit: number = 10): Promise<WelcomeHistoryEntry[]> {
    // Note: LIMIT value embedded directly due to mysql2 prepared statement issues with LIMIT placeholders
    const safeLimit = Math.max(1, Math.min(1000, Math.floor(limit)));
    return this.db.query<(WelcomeHistoryEntry & RowDataPacket)[]>(
      `SELECT * FROM welcome_history WHERE guild_id = ? ORDER BY created_at DESC LIMIT ${safeLimit}`,
      [guildId]
    );
  }

  /**
   * Generate AI welcome message for a member
   *
   * @returns Object with generated text and tokens used, or null if AI unavailable
   */
  async generateAIMessage(
    username: string,
    serverName: string,
    customPrompt?: string | null
  ): Promise<{ text: string; tokensUsed: number } | null> {
    const registry = getAIRegistry();
    if (!registry.hasConfiguredProvider()) {
      logger.debug('No AI provider configured, skipping AI message generation');
      return null;
    }

    const prompt = (customPrompt || DEFAULT_AI_PROMPT)
      .replace(/{username}/g, username)
      .replace(/{server}/g, serverName);

    try {
      const response = await chat(prompt, {
        maxTokens: 150,
        temperature: 0.8, // Higher for more creative messages
      });

      const tokensUsed = response.usage
        ? response.usage.inputTokens + response.usage.outputTokens
        : 0;

      return {
        text: response.text.trim(),
        tokensUsed,
      };
    } catch (error) {
      logger.error('Failed to generate AI welcome message:', error);
      return null;
    }
  }

  /**
   * Check if AI is available for welcome messages
   */
  isAIAvailable(): boolean {
    return getAIRegistry().hasConfiguredProvider();
  }

  // ============================================
  // Image Management Methods
  // ============================================

  /**
   * Save a generated welcome image to the database
   * @returns The generated image ID
   */
  async saveImage(image: Omit<WelcomeImage, 'id' | 'created_at'>): Promise<string> {
    const id = uuidv4();
    await this.db.execute(
      `INSERT INTO welcome_images
       (id, guild_id, user_id, image_path, prompt_index, prompt_text, model, cost)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        image.guild_id,
        image.user_id,
        image.image_path,
        image.prompt_index,
        image.prompt_text,
        image.model,
        image.cost,
      ]
    );

    logger.debug(`Saved welcome image ${id} for user ${image.user_id}`);
    return id;
  }

  /**
   * Get all welcome images for a user in a guild
   */
  async getImagesForUser(guildId: string, userId: string): Promise<WelcomeImage[]> {
    return this.db.query<(WelcomeImage & RowDataPacket)[]>(
      `SELECT * FROM welcome_images
       WHERE guild_id = ? AND user_id = ?
       ORDER BY created_at DESC`,
      [guildId, userId]
    );
  }

  /**
   * Get a specific welcome image by ID
   */
  async getImageById(imageId: string): Promise<WelcomeImage | null> {
    const rows = await this.db.query<(WelcomeImage & RowDataPacket)[]>(
      `SELECT * FROM welcome_images WHERE id = ?`,
      [imageId]
    );
    return rows[0] || null;
  }

  /**
   * Get the most recent welcome image for a user in a guild
   */
  async getLatestImageForUser(guildId: string, userId: string): Promise<WelcomeImage | null> {
    const rows = await this.db.query<(WelcomeImage & RowDataPacket)[]>(
      `SELECT * FROM welcome_images
       WHERE guild_id = ? AND user_id = ?
       ORDER BY created_at DESC
       LIMIT 1`,
      [guildId, userId]
    );
    return rows[0] || null;
  }

  /**
   * Delete a welcome image by ID
   */
  async deleteImage(imageId: string): Promise<void> {
    await this.db.execute(
      `DELETE FROM welcome_images WHERE id = ?`,
      [imageId]
    );
    logger.debug(`Deleted welcome image ${imageId}`);
  }

  /**
   * Get image count for a user (useful for stats)
   */
  async getImageCountForUser(guildId: string, userId: string): Promise<number> {
    const rows = await this.db.query<({ count: number } & RowDataPacket)[]>(
      `SELECT COUNT(*) as count FROM welcome_images WHERE guild_id = ? AND user_id = ?`,
      [guildId, userId]
    );
    return rows[0]?.count ?? 0;
  }

  /**
   * Check if a user has already been welcomed in a guild
   */
  async hasBeenWelcomed(guildId: string, userId: string): Promise<boolean> {
    const rows = await this.db.query<({ count: number } & RowDataPacket)[]>(
      `SELECT COUNT(*) as count FROM welcome_history
       WHERE guild_id = ? AND user_id = ? AND error_message IS NULL`,
      [guildId, userId]
    );
    return (rows[0]?.count ?? 0) > 0;
  }

  /**
   * Get list of user IDs that have been welcomed in a guild
   */
  async getWelcomedUserIds(guildId: string): Promise<Set<string>> {
    const rows = await this.db.query<({ user_id: string } & RowDataPacket)[]>(
      `SELECT DISTINCT user_id FROM welcome_history
       WHERE guild_id = ? AND error_message IS NULL`,
      [guildId]
    );
    return new Set(rows.map(r => r.user_id));
  }
}
