-- Make competition_id nullable (code no longer provides it)
ALTER TABLE humor_submissions ALTER COLUMN competition_id DROP NOT NULL;
ALTER TABLE humor_submissions ALTER COLUMN competition_id DROP DEFAULT;

ALTER TABLE humor_winners ALTER COLUMN competition_id DROP NOT NULL;
ALTER TABLE humor_winners ALTER COLUMN competition_id DROP DEFAULT;

-- Drop the foreign key constraints referencing humor_competitions
ALTER TABLE humor_submissions DROP CONSTRAINT IF EXISTS humor_submissions_competition_id_fkey;
ALTER TABLE humor_winners DROP CONSTRAINT IF EXISTS humor_winners_competition_id_fkey;
ALTER TABLE humor_winners DROP CONSTRAINT IF EXISTS humor_winners_submission_id_fkey;

-- Add unique constraint for one submission per user per thread
CREATE UNIQUE INDEX IF NOT EXISTS idx_humor_sub_thread_user ON humor_submissions (thread_id, user_id);
