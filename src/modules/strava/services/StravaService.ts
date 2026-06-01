import { DatabaseService, RowDataPacket } from '../../../core/database/postgres.js';
import { Logger } from '../../../shared/utils/logger.js';

const logger = new Logger('Strava:Service');

export interface StravaGuildChannel {
  guild_id: string;
  channel_id: string;
}

export interface StravaDispatchedEvent {
  event_id: string;
  guild_id: string;
  channel_id: string | null;
  message_id: string | null;
}

/**
 * Bot-side CRUD over our two tables. Everything Strava-related on the
 * website side (athlete tokens, raw events) is owned by quadslab.io;
 * this service stays focused on the bot's two responsibilities:
 *   - which channel to post into for each guild
 *   - which events we've already posted (for catch-up after a LISTEN
 *     reconnect or a bot restart)
 */
export class StravaService {
  constructor(private db: DatabaseService) {}

  // ─── Guild channels ─────────────────────────────────────────────

  async getGuildChannel(guildId: string): Promise<StravaGuildChannel | null> {
    const rows = await this.db.query<(StravaGuildChannel & RowDataPacket)[]>(
      'SELECT * FROM strava_guild_channels WHERE guild_id = ?',
      [guildId],
    );
    return rows[0] ?? null;
  }

  async setGuildChannel(guildId: string, channelId: string): Promise<void> {
    await this.db.execute(
      `INSERT INTO strava_guild_channels (guild_id, channel_id, updated_at)
         VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT (guild_id) DO UPDATE
         SET channel_id = EXCLUDED.channel_id,
             updated_at = CURRENT_TIMESTAMP`,
      [guildId, channelId],
    );
    logger.debug(`Set guild ${guildId} → channel ${channelId}`);
  }

  async clearGuildChannel(guildId: string): Promise<void> {
    await this.db.execute(
      'DELETE FROM strava_guild_channels WHERE guild_id = ?',
      [guildId],
    );
  }

  async listGuildChannels(): Promise<StravaGuildChannel[]> {
    return this.db.query<(StravaGuildChannel & RowDataPacket)[]>(
      'SELECT * FROM strava_guild_channels',
    );
  }

  // ─── Dispatched event tracking ──────────────────────────────────

  /**
   * Idempotent: record that we posted (or intentionally skipped) a
   * given event in a guild. Returns true if this is the first record
   * for the pair, false if it already existed (caller can use this to
   * decide whether to post again).
   */
  async tryRecordDispatch(
    eventId: string,
    guildId: string,
    channelId: string | null,
    messageId: string | null,
  ): Promise<boolean> {
    const result = await this.db.execute(
      `INSERT INTO strava_dispatched_events (event_id, guild_id, channel_id, message_id)
         VALUES (?, ?, ?, ?)
       ON CONFLICT (event_id, guild_id) DO NOTHING`,
      [eventId, guildId, channelId, messageId],
    );
    return result.affectedRows > 0;
  }

  async wasDispatched(eventId: string, guildId: string): Promise<boolean> {
    const rows = await this.db.query<(StravaDispatchedEvent & RowDataPacket)[]>(
      'SELECT * FROM strava_dispatched_events WHERE event_id = ? AND guild_id = ?',
      [eventId, guildId],
    );
    return rows.length > 0;
  }
}
