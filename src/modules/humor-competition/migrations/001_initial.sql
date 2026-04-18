-- Humor Competition module initial migration
-- Zero-config: bot auto-creates forum channel and roles on enable.
-- This table just stores the IDs of auto-managed resources.

CREATE TABLE IF NOT EXISTS humor_guild_settings (
  id VARCHAR(36) PRIMARY KEY,
  guild_id VARCHAR(20) NOT NULL UNIQUE,
  forum_channel_id VARCHAR(20),
  trusted_role_id VARCHAR(20),
  winner_role_id VARCHAR(20),
  setup_complete BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Each daily competition (one forum post per day)
CREATE TABLE IF NOT EXISTS humor_competitions (
  id VARCHAR(36) PRIMARY KEY,
  guild_id VARCHAR(20) NOT NULL,
  source_image_url TEXT,
  source_posted_by VARCHAR(20),
  panel_message_id VARCHAR(20),
  thread_id VARCHAR(20),
  status VARCHAR(20) NOT NULL DEFAULT 'waiting',
  started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  voting_ends_at TIMESTAMP,
  ended_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_humor_comp_guild ON humor_competitions (guild_id);
CREATE INDEX IF NOT EXISTS idx_humor_comp_status ON humor_competitions (guild_id, status);
CREATE INDEX IF NOT EXISTS idx_humor_comp_ends ON humor_competitions (voting_ends_at);

-- User submissions (images posted in the forum post thread)
CREATE TABLE IF NOT EXISTS humor_submissions (
  id VARCHAR(36) PRIMARY KEY,
  competition_id VARCHAR(36) NOT NULL REFERENCES humor_competitions(id) ON DELETE CASCADE,
  guild_id VARCHAR(20) NOT NULL,
  user_id VARCHAR(20) NOT NULL,
  message_id VARCHAR(20) NOT NULL,
  image_url TEXT NOT NULL,
  vote_count INT NOT NULL DEFAULT 0,
  submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(competition_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_humor_sub_comp ON humor_submissions (competition_id);
CREATE INDEX IF NOT EXISTS idx_humor_sub_msg ON humor_submissions (message_id);

-- Winner history
CREATE TABLE IF NOT EXISTS humor_winners (
  id VARCHAR(36) PRIMARY KEY,
  competition_id VARCHAR(36) NOT NULL REFERENCES humor_competitions(id) ON DELETE CASCADE,
  guild_id VARCHAR(20) NOT NULL,
  user_id VARCHAR(20) NOT NULL,
  submission_id VARCHAR(36) NOT NULL REFERENCES humor_submissions(id) ON DELETE CASCADE,
  vote_count INT NOT NULL,
  crowned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_humor_winners_guild ON humor_winners (guild_id);
CREATE INDEX IF NOT EXISTS idx_humor_winners_user ON humor_winners (guild_id, user_id);
