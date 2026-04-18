-- Add columns that were missing from the original 001 schema
-- and not added by 002 (which ran before the fix)

ALTER TABLE humor_guild_settings ADD COLUMN IF NOT EXISTS trusted_role_id VARCHAR(20);
ALTER TABLE humor_guild_settings ADD COLUMN IF NOT EXISTS winner_role_id VARCHAR(20);
ALTER TABLE humor_guild_settings ADD COLUMN IF NOT EXISTS forum_channel_id VARCHAR(20);
ALTER TABLE humor_guild_settings ADD COLUMN IF NOT EXISTS setup_complete BOOLEAN NOT NULL DEFAULT FALSE;
