-- Switch from competition-centric to thread-centric model.
-- The thread index is a lightweight lookup table keyed by date label.

CREATE TABLE IF NOT EXISTS humor_thread_index (
  id VARCHAR(36) PRIMARY KEY,
  guild_id VARCHAR(20) NOT NULL,
  thread_id VARCHAR(20) NOT NULL UNIQUE,
  date_label VARCHAR(50) NOT NULL,
  panel_message_id VARCHAR(20),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_humor_thread_guild ON humor_thread_index (guild_id);
CREATE INDEX IF NOT EXISTS idx_humor_thread_date ON humor_thread_index (guild_id, date_label);

-- Add thread_id to submissions (replacing competition_id)
ALTER TABLE humor_submissions ADD COLUMN IF NOT EXISTS thread_id VARCHAR(20);

-- Add thread_id to winners (replacing competition_id)
ALTER TABLE humor_winners ADD COLUMN IF NOT EXISTS thread_id VARCHAR(20);

-- Make thread_id + user_id unique for submissions (one per person per thread)
-- Drop old unique constraint first if it exists
ALTER TABLE humor_submissions DROP CONSTRAINT IF EXISTS humor_submissions_competition_id_user_id_key;
