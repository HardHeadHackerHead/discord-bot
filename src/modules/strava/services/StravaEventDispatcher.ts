import { Client, ChannelType, type Guild, type EmbedBuilder } from 'discord.js';
import { Logger } from '../../../shared/utils/logger.js';
import type { StravaService } from './StravaService.js';
import type { StravaListenService, ListenHandler } from './StravaListenService.js';
import {
  buildActivityEmbeds,
  type ActivityPayload,
  type AthleteDisplay,
  type PrivacyPrefs,
} from '../embeds/ActivityEmbed.js';

const logger = new Logger('Strava:Dispatch');

/**
 * Joined row shape from the website DB. Lowercased identifiers come
 * from Postgres; the camelCase ones come from Prisma's column-name
 * mapping (we have to quote them in raw SQL).
 */
interface JoinedEventRow extends Record<string, unknown> {
  id: string;
  athleteId: string;          // BigInt arrives as string from pg
  stravaActivityId: string;
  aspectType: 'create' | 'update' | 'delete' | 'backfill';
  payload: ActivityPayload | null;
  processedAt: Date | null;
  // Joined from strava_integration
  userId: string | null;
  athleteUsername: string | null;
  athleteFirstName: string | null;
  athleteLastName: string | null;
  athleteProfilePicUrl: string | null;
  privacyMode: string | null;
  units: string | null;
  showHeartRate: boolean | null;
  showPaceChart: boolean | null;
  // Joined from "user"
  discordId: string | null;
}

const JOINED_SELECT = `
  SELECT
    e.id,
    e."athleteId"            AS "athleteId",
    e."stravaActivityId"     AS "stravaActivityId",
    e."aspectType"           AS "aspectType",
    e."payload"              AS payload,
    e."processedAt"          AS "processedAt",
    i."userId"               AS "userId",
    i."athleteUsername"      AS "athleteUsername",
    i."athleteFirstName"     AS "athleteFirstName",
    i."athleteLastName"      AS "athleteLastName",
    i."athleteProfilePicUrl" AS "athleteProfilePicUrl",
    i."privacyMode"          AS "privacyMode",
    i."units"                AS units,
    i."showHeartRate"        AS "showHeartRate",
    i."showPaceChart"        AS "showPaceChart",
    u."discordId"            AS "discordId"
  FROM strava_activity_event e
  LEFT JOIN strava_integration i ON e."athleteId" = i."athleteId"
  LEFT JOIN "user" u             ON i."userId"   = u.id
`;

/**
 * Handles incoming Strava activity events. For each event:
 *   1. Loads the joined row (event + integration + user).
 *   2. For each guild with a configured channel:
 *      - Skip if we already dispatched this (event, guild) pair.
 *      - Skip if the user isn't a member of that guild.
 *      - Post the embed; record the dispatch.
 *
 * Idempotent against re-entry — the bot-side dispatched-events table
 * dedupes per (event_id, guild_id) so reconnect catch-up and the
 * NOTIFY for the same event race harmlessly.
 */
export class StravaEventDispatcher implements ListenHandler {
  constructor(
    private readonly client: Client,
    private readonly bot: StravaService,
    private readonly listen: StravaListenService,
  ) {}

  async handleEvent(
    eventId: string,
    opts: { force?: boolean } = {},
  ): Promise<void> {
    const rows = await this.listen.query<JoinedEventRow>(
      `${JOINED_SELECT} WHERE e.id = $1 LIMIT 1`,
      [eventId],
    );
    const event = rows[0];
    if (!event) {
      logger.debug(`event ${eventId} not found in website DB`);
      return;
    }

    // Athlete-update events (deauth) and delete events come through
    // here too; we don't post anything for those (yet). 'backfill' is
    // our synthetic aspectType used by the /strava backfill command.
    if (
      event.aspectType !== 'create' &&
      event.aspectType !== 'update' &&
      event.aspectType !== 'backfill'
    ) return;
    if (!event.payload) return;
    if (!event.discordId) {
      logger.debug(`event ${eventId} has no linked discord user; skipping`);
      return;
    }
    // Suspect activities and explicit-private activities still get
    // delivered by Strava; suppress the latter.
    if (event.payload.private) return;

    const athlete: AthleteDisplay = {
      athleteId: BigInt(event.athleteId),
      firstName: event.athleteFirstName,
      lastName: event.athleteLastName,
      username: event.athleteUsername,
      profilePicUrl: event.athleteProfilePicUrl,
    };

    // Privacy is owned by the website; we copy the current values at
    // dispatch time. Defaults match the schema defaults so an
    // unmigrated row (or a missing-integration race) renders safely.
    const privacy: PrivacyPrefs = {
      privacyMode: event.privacyMode ?? 'community',
      units: event.units ?? 'both',
      showHeartRate: event.showHeartRate ?? true,
      showPaceChart: event.showPaceChart ?? true,
    };

    const channels = await this.bot.listGuildChannels();
    for (const ch of channels) {
      // `force` bypasses the per-guild dedup so `/strava replay` can
      // re-post an event the bot already dispatched once.
      const already = !opts.force && (await this.bot.wasDispatched(eventId, ch.guild_id));
      if (already) continue;

      const guild = this.client.guilds.cache.get(ch.guild_id);
      if (!guild) {
        // Bot not in this guild anymore; record a "skipped" row so we
        // don't keep re-trying on reconnect catch-ups.
        await this.bot.tryRecordDispatch(eventId, ch.guild_id, null, null, event.stravaActivityId);
        continue;
      }

      const isMember = await this.isGuildMember(guild.id, event.discordId);
      if (!isMember) {
        await this.bot.tryRecordDispatch(eventId, ch.guild_id, null, null, event.stravaActivityId);
        continue;
      }

      const channel = guild.channels.cache.get(ch.channel_id);
      if (!channel || channel.type !== ChannelType.GuildText) {
        logger.warn(
          `Configured channel ${ch.channel_id} in guild ${ch.guild_id} is missing or not a text channel`,
        );
        await this.bot.tryRecordDispatch(eventId, ch.guild_id, null, null, event.stravaActivityId);
        continue;
      }

      try {
        const embeds = await buildActivityEmbeds(
          event.payload,
          athlete,
          privacy,
          `<@${event.discordId}>`,
        );

        // If we already posted a message for THIS activity in this guild
        // — e.g. the original `create`, and this is a follow-up `update`
        // (renamed activity, added photo, corrected stats) — edit that
        // message in place instead of posting a duplicate. `force`
        // (/strava replay) intentionally always posts a fresh message.
        //
        // This lookup is only an optimization: if it fails (e.g. the
        // dedup migration hasn't landed on this DB yet), we must still
        // fall through and POST rather than swallow the activity.
        let prior: Awaited<ReturnType<typeof this.bot.findActivityMessage>> = null;
        if (!opts.force) {
          try {
            prior = await this.bot.findActivityMessage(event.stravaActivityId, ch.guild_id);
          } catch (err) {
            logger.error(
              `findActivityMessage failed for activity ${event.stravaActivityId} in guild ${ch.guild_id}; posting without edit-dedup:`,
              err,
            );
          }
        }

        if (prior?.channel_id && prior.message_id) {
          const edited = await this.tryEditMessage(
            guild,
            prior.channel_id,
            prior.message_id,
            embeds,
          );
          if (edited) {
            await this.bot.tryRecordDispatch(
              eventId,
              ch.guild_id,
              prior.channel_id,
              prior.message_id,
              event.stravaActivityId,
            );
            logger.info(
              `edited event ${eventId} into existing message ${prior.message_id} → guild ${ch.guild_id} channel ${prior.channel_id} (activity ${event.stravaActivityId})`,
            );
            continue;
          }
          // The original message is gone (deleted, or channel changed
          // type). Fall through and post a fresh one.
          logger.warn(
            `prior message ${prior.message_id} for activity ${event.stravaActivityId} in guild ${ch.guild_id} could not be edited; posting a new message`,
          );
        }

        const msg = await channel.send({ embeds });
        await this.bot.tryRecordDispatch(
          eventId,
          ch.guild_id,
          ch.channel_id,
          msg.id,
          event.stravaActivityId,
        );
        logger.info(
          `posted event ${eventId} (${embeds.length} embed${embeds.length === 1 ? '' : 's'}) → guild ${ch.guild_id} channel ${ch.channel_id} message ${msg.id}`,
        );
      } catch (err) {
        logger.error(
          `Failed to post event ${eventId} to ${ch.guild_id}/${ch.channel_id}:`,
          err,
        );
        // Do not record dispatch — let a future catch-up retry.
      }
    }
  }

  /**
   * Sweep recent processed-by-website events that haven't yet been
   * dispatched to any guild. Runs after a successful LISTEN reconnect.
   * Bounded to the last 24 hours to keep the sweep cheap.
   */
  async catchUp(): Promise<void> {
    const rows = await this.listen.query<{ id: string }>(
      `SELECT e.id
         FROM strava_activity_event e
        WHERE e."processedAt" IS NOT NULL
          AND e."aspectType" IN ('create', 'update', 'backfill')
          AND e."createdAt" > now() - interval '24 hours'
        ORDER BY e."createdAt" ASC`,
    );
    if (rows.length === 0) return;
    logger.info(`catch-up: ${rows.length} recent events to consider`);
    for (const row of rows) {
      try {
        await this.handleEvent(row.id);
      } catch (err) {
        logger.error(`catch-up handleEvent(${row.id}) failed:`, err);
      }
    }
  }

  /**
   * Find the most recent processed activity event for the given
   * Discord user. Returns null if the user isn't linked or has no
   * processable events. Used by `/strava replay`.
   */
  async findLatestEventForDiscordUser(discordId: string): Promise<string | null> {
    const rows = await this.listen.query<{ id: string }>(
      `SELECT e.id
         FROM strava_activity_event e
         JOIN strava_integration i ON e."athleteId" = i."athleteId"
         JOIN "user" u             ON i."userId"   = u.id
        WHERE u."discordId" = $1
          AND e."processedAt" IS NOT NULL
          AND e."aspectType" IN ('create', 'update', 'backfill')
          AND e.payload IS NOT NULL
        ORDER BY e."createdAt" DESC
        LIMIT 1`,
      [discordId],
    );
    return rows[0]?.id ?? null;
  }

  /**
   * Edit a previously-posted activity message in place. Returns false if
   * the message can't be edited (channel gone/not text, message deleted,
   * missing permissions) so the caller can fall back to posting anew.
   */
  private async tryEditMessage(
    guild: Guild,
    channelId: string,
    messageId: string,
    embeds: EmbedBuilder[],
  ): Promise<boolean> {
    try {
      const channel = guild.channels.cache.get(channelId);
      if (!channel || channel.type !== ChannelType.GuildText) return false;
      const msg = await channel.messages.fetch(messageId);
      await msg.edit({ embeds });
      return true;
    } catch (err) {
      logger.debug(
        `edit of message ${messageId} in ${guild.id}/${channelId} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  }

  private async isGuildMember(guildId: string, userId: string): Promise<boolean> {
    const guild = this.client.guilds.cache.get(guildId);
    if (!guild) return false;
    if (guild.members.cache.has(userId)) return true;
    try {
      const member = await guild.members.fetch(userId);
      return !!member;
    } catch {
      return false;
    }
  }
}
