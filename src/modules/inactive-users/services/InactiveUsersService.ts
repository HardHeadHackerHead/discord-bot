/**
 * Inactive Users Service
 * Queries for users with zero messages and/or zero voice time
 */

import { DatabaseService, RowDataPacket } from '../../../core/database/postgres.js';
import { Logger } from '../../../shared/utils/logger.js';

const logger = new Logger('InactiveUsers:Service');

export interface InactiveUser {
  user_id: string;
  joined_at: Date | null;
  message_count: number;
  voice_seconds: number;
}

export type InactiveFilter = 'all' | 'no_messages' | 'no_voice';

export class InactiveUsersService {
  constructor(private db: DatabaseService) {}

  /**
   * Get users who have zero activity based on the filter
   * @param guildId The guild to check
   * @param filter 'all' = no messages AND no voice, 'no_messages' = just no messages, 'no_voice' = just no voice
   * @param limit Max users to return
   * @param offset Pagination offset
   */
  async getInactiveUsers(
    guildId: string,
    filter: InactiveFilter = 'all',
    limit: number = 25,
    offset: number = 0
  ): Promise<InactiveUser[]> {
    let whereClause: string;

    switch (filter) {
      case 'no_messages':
        whereClause = '(ms.id IS NULL OR ms.message_count = 0)';
        break;
      case 'no_voice':
        whereClause = '(vs.id IS NULL OR vs.total_seconds = 0)';
        break;
      case 'all':
      default:
        whereClause = '(ms.id IS NULL OR ms.message_count = 0) AND (vs.id IS NULL OR vs.total_seconds = 0)';
        break;
    }

    // Note: guild_members uses camelCase (guildId, userId, isActive, joinedAt)
    // Module tables use snake_case (guild_id, user_id)
    // LIMIT and OFFSET are interpolated directly since they're validated integers
    const query = `
      SELECT
        gm.userId as user_id,
        gm.joinedAt as joined_at,
        COALESCE(ms.message_count, 0) as message_count,
        COALESCE(vs.total_seconds, 0) as voice_seconds
      FROM guild_members gm
      LEFT JOIN messages_stats ms ON gm.userId = ms.user_id AND gm.guildId = ms.guild_id
      LEFT JOIN voicetime_stats vs ON gm.userId = vs.user_id AND gm.guildId = vs.guild_id
      WHERE gm.guildId = ? AND gm.isActive = TRUE
        AND ${whereClause}
      ORDER BY gm.joinedAt ASC
      LIMIT ${Number(limit)} OFFSET ${Number(offset)}
    `;

    try {
      const rows = await this.db.query<(InactiveUser & RowDataPacket)[]>(
        query,
        [guildId]
      );
      return rows;
    } catch (error) {
      logger.error('Failed to get inactive users:', error);
      return [];
    }
  }

  /**
   * Get count of inactive users by filter
   */
  async getInactiveUserCount(
    guildId: string,
    filter: InactiveFilter = 'all'
  ): Promise<number> {
    let whereClause: string;

    switch (filter) {
      case 'no_messages':
        whereClause = '(ms.id IS NULL OR ms.message_count = 0)';
        break;
      case 'no_voice':
        whereClause = '(vs.id IS NULL OR vs.total_seconds = 0)';
        break;
      case 'all':
      default:
        whereClause = '(ms.id IS NULL OR ms.message_count = 0) AND (vs.id IS NULL OR vs.total_seconds = 0)';
        break;
    }

    // Note: guild_members uses camelCase (guildId, userId, isActive)
    const query = `
      SELECT COUNT(*) as count
      FROM guild_members gm
      LEFT JOIN messages_stats ms ON gm.userId = ms.user_id AND gm.guildId = ms.guild_id
      LEFT JOIN voicetime_stats vs ON gm.userId = vs.user_id AND gm.guildId = vs.guild_id
      WHERE gm.guildId = ? AND gm.isActive = TRUE
        AND ${whereClause}
    `;

    try {
      const rows = await this.db.query<({ count: number } & RowDataPacket)[]>(
        query,
        [guildId]
      );
      return rows[0]?.count ?? 0;
    } catch (error) {
      logger.error('Failed to get inactive user count:', error);
      return 0;
    }
  }

  /**
   * Get summary stats for all filter types
   */
  async getInactiveStats(guildId: string): Promise<{
    totalMembers: number;
    noActivity: number;
    noMessages: number;
    noVoice: number;
  }> {
    try {
      // Get total active members (guild_members uses camelCase)
      const totalQuery = `
        SELECT COUNT(*) as count FROM guild_members
        WHERE guildId = ? AND isActive = TRUE
      `;
      const totalRows = await this.db.query<({ count: number } & RowDataPacket)[]>(
        totalQuery,
        [guildId]
      );
      const totalMembers = totalRows[0]?.count ?? 0;

      // Get counts for each filter type
      const [noActivity, noMessages, noVoice] = await Promise.all([
        this.getInactiveUserCount(guildId, 'all'),
        this.getInactiveUserCount(guildId, 'no_messages'),
        this.getInactiveUserCount(guildId, 'no_voice'),
      ]);

      return {
        totalMembers,
        noActivity,
        noMessages,
        noVoice,
      };
    } catch (error) {
      logger.error('Failed to get inactive stats:', error);
      return {
        totalMembers: 0,
        noActivity: 0,
        noMessages: 0,
        noVoice: 0,
      };
    }
  }
}
