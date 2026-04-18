-- Migrate guild settings to zero-config schema.
-- Adds forum_channel_id and setup_complete, drops old configurable fields.

ALTER TABLE humor_guild_settings ADD COLUMN IF NOT EXISTS forum_channel_id VARCHAR(20);
ALTER TABLE humor_guild_settings ADD COLUMN IF NOT EXISTS trusted_role_id VARCHAR(20);
ALTER TABLE humor_guild_settings ADD COLUMN IF NOT EXISTS winner_role_id VARCHAR(20);
ALTER TABLE humor_guild_settings ADD COLUMN IF NOT EXISTS setup_complete BOOLEAN NOT NULL DEFAULT FALSE;

-- Drop columns that are now hardcoded constants
ALTER TABLE humor_guild_settings DROP COLUMN IF EXISTS channel_id;
ALTER TABLE humor_guild_settings DROP COLUMN IF EXISTS voting_duration_hours;
ALTER TABLE humor_guild_settings DROP COLUMN IF EXISTS daily_thread_hour;
ALTER TABLE humor_guild_settings DROP COLUMN IF EXISTS self_vote_allowed;
ALTER TABLE humor_guild_settings DROP COLUMN IF EXISTS remove_old_king_role;
ALTER TABLE humor_guild_settings DROP COLUMN IF EXISTS king_role_retention_days;
ALTER TABLE humor_guild_settings DROP COLUMN IF EXISTS min_votes_to_win;
ALTER TABLE humor_guild_settings DROP COLUMN IF EXISTS auto_create_thread;
ALTER TABLE humor_guild_settings DROP COLUMN IF EXISTS max_submissions_per_user;
ALTER TABLE humor_guild_settings DROP COLUMN IF EXISTS announce_channel_id;
ALTER TABLE humor_guild_settings DROP COLUMN IF EXISTS updated_at;

-- Drop the votes table if it exists from an earlier schema
DROP TABLE IF EXISTS humor_votes;

-- Drop the authorized posters table if it exists from an earlier schema
DROP TABLE IF EXISTS humor_authorized_posters;
