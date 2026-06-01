-- Strava Module — bot-side tables.
--
-- The Strava integration itself (athlete tokens, raw activity events)
-- lives in the quadslab.io website's database. The bot only stores:
--   1. Per-guild channel mapping: which channel should activity posts
--      go into for a given guild.
--   2. Dispatched-event tracking: which website-side activity events
--      we've already posted to Discord, so a LISTEN reconnect doesn't
--      double-post.

CREATE TABLE IF NOT EXISTS strava_guild_channels (
  guild_id    VARCHAR(20) PRIMARY KEY,
  channel_id  VARCHAR(20) NOT NULL,
  created_at  TIMESTAMP   DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP   DEFAULT CURRENT_TIMESTAMP
);

-- One row per (event, channel we posted into). If a single activity
-- fans out to multiple guilds the unique pair lets us record a post
-- per channel without losing the others. message_id is null when we
-- intentionally skipped (e.g. user wasn't actually in the guild).
CREATE TABLE IF NOT EXISTS strava_dispatched_events (
  event_id    VARCHAR(50) NOT NULL,
  guild_id    VARCHAR(20) NOT NULL,
  channel_id  VARCHAR(20),
  message_id  VARCHAR(20),
  posted_at   TIMESTAMP   DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (event_id, guild_id)
);

CREATE INDEX IF NOT EXISTS idx_strava_dispatched_posted_at
  ON strava_dispatched_events (posted_at);
