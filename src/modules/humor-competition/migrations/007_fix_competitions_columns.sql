-- Fix competitions table: add new columns, drop old ones.
-- Using only simple ALTER statements (no DO blocks - migration runner splits on semicolons).

-- Add all columns the code expects (IF NOT EXISTS is safe)
ALTER TABLE humor_competitions ADD COLUMN IF NOT EXISTS panel_message_id VARCHAR(20);
ALTER TABLE humor_competitions ADD COLUMN IF NOT EXISTS thread_id VARCHAR(20);
ALTER TABLE humor_competitions ADD COLUMN IF NOT EXISTS source_image_url TEXT;
ALTER TABLE humor_competitions ADD COLUMN IF NOT EXISTS source_posted_by VARCHAR(20);

-- Drop old column names that were renamed (IF EXISTS is safe)
ALTER TABLE humor_competitions DROP COLUMN IF EXISTS message_id;
ALTER TABLE humor_competitions DROP COLUMN IF EXISTS image_url;
ALTER TABLE humor_competitions DROP COLUMN IF EXISTS posted_by;
