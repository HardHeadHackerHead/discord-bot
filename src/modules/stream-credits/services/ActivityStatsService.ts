import { DatabaseService, RowDataPacket } from '../../../core/database/postgres.js';
import { Logger } from '../../../shared/utils/logger.js';

const logger = new Logger('StreamCredits:Activity');

export interface TopMember {
  userId: string;
  displayName: string;
  avatarUrl: string;
  messageCount: number;
  voiceSeconds: number;
}

export interface ActivityStats {
  topMembers: TopMember[];
  totalMessages: number;
  totalVoiceHours: number;
  activeChatterCount: number;
  activeVoiceCount: number;
}

export interface NewMember {
  userId: string;
  displayName: string;
  avatarUrl: string;
  joinedAt: string;
}

export class ActivityStatsService {
  private db: DatabaseService;

  constructor(db: DatabaseService) {
    this.db = db;
  }

  async fetchActivityStats(
    guildId: string,
    memberMap: Map<string, { displayName: string; avatarUrl: string }>
  ): Promise<ActivityStats> {
    logger.info(`Fetching activity stats for guild: ${guildId}`);

    // Top 10 by messages
    const msgLeaders = await this.db.query<(RowDataPacket & { user_id: string; message_count: number })[]>(
      `SELECT user_id, message_count FROM messages_stats
       WHERE guild_id = ? AND message_count > 0
       ORDER BY message_count DESC LIMIT 10`,
      [guildId]
    );

    // Top 10 by voice
    const voiceLeaders = await this.db.query<(RowDataPacket & { user_id: string; total_seconds: number })[]>(
      `SELECT user_id, total_seconds FROM voicetime_stats
       WHERE guild_id = ? AND total_seconds > 0
       ORDER BY total_seconds DESC LIMIT 10`,
      [guildId]
    );

    // Build combined top members — union of message and voice leaders
    const userScores = new Map<string, { messages: number; voice: number }>();

    for (const row of msgLeaders) {
      const existing = userScores.get(row.user_id) ?? { messages: 0, voice: 0 };
      existing.messages = row.message_count;
      userScores.set(row.user_id, existing);
    }
    for (const row of voiceLeaders) {
      const existing = userScores.get(row.user_id) ?? { messages: 0, voice: 0 };
      existing.voice = row.total_seconds;
      userScores.set(row.user_id, existing);
    }

    // Sort by combined activity (normalize messages and voice to a score)
    const topMembers: TopMember[] = [...userScores.entries()]
      .map(([userId, scores]) => {
        const member = memberMap.get(userId);
        return {
          userId,
          displayName: member?.displayName ?? userId,
          avatarUrl: member?.avatarUrl ?? '',
          messageCount: scores.messages,
          voiceSeconds: scores.voice,
        };
      })
      .filter((m) => m.avatarUrl) // Only include members we have data for
      .sort((a, b) => (b.messageCount + b.voiceSeconds) - (a.messageCount + a.voiceSeconds))
      .slice(0, 10);

    // Totals
    const totalMsgResult = await this.db.query<(RowDataPacket & { total: number })[]>(
      'SELECT COALESCE(SUM(message_count), 0) as total FROM messages_stats WHERE guild_id = ?',
      [guildId]
    );
    const totalVoiceResult = await this.db.query<(RowDataPacket & { total: number })[]>(
      'SELECT COALESCE(SUM(total_seconds), 0) as total FROM voicetime_stats WHERE guild_id = ?',
      [guildId]
    );

    const chatterCount = await this.db.query<(RowDataPacket & { count: number })[]>(
      'SELECT COUNT(*) as count FROM messages_stats WHERE guild_id = ? AND message_count > 0',
      [guildId]
    );
    const voiceCount = await this.db.query<(RowDataPacket & { count: number })[]>(
      'SELECT COUNT(*) as count FROM voicetime_stats WHERE guild_id = ? AND total_seconds > 0',
      [guildId]
    );

    const totalMessages = totalMsgResult[0]?.total ?? 0;
    const totalVoiceSeconds = totalVoiceResult[0]?.total ?? 0;

    logger.info(`Activity stats: ${totalMessages} messages, ${Math.round(totalVoiceSeconds / 3600)}h voice`);

    return {
      topMembers,
      totalMessages,
      totalVoiceHours: Math.round(totalVoiceSeconds / 3600),
      activeChatterCount: chatterCount[0]?.count ?? 0,
      activeVoiceCount: voiceCount[0]?.count ?? 0,
    };
  }
}
