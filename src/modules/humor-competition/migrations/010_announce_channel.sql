-- Add configurable announcement channel (defaults to "general" on first setup)

ALTER TABLE humor_guild_settings ADD COLUMN IF NOT EXISTS announce_channel_id VARCHAR(20);
