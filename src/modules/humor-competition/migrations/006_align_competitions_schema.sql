-- Align humor_competitions with current code expectations.
-- The original 001 had: message_id, image_url NOT NULL, posted_by NOT NULL
-- Current code expects: panel_message_id, thread_id, source_image_url, source_posted_by (all nullable)

-- Add columns that may not exist
ALTER TABLE humor_competitions ADD COLUMN IF NOT EXISTS panel_message_id VARCHAR(20);
ALTER TABLE humor_competitions ADD COLUMN IF NOT EXISTS thread_id VARCHAR(20);
ALTER TABLE humor_competitions ADD COLUMN IF NOT EXISTS source_image_url TEXT;
ALTER TABLE humor_competitions ADD COLUMN IF NOT EXISTS source_posted_by VARCHAR(20);

-- If the old message_id column exists, migrate its data to panel_message_id then drop it
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'humor_competitions' AND column_name = 'message_id'
  ) THEN
    UPDATE humor_competitions SET panel_message_id = message_id WHERE panel_message_id IS NULL AND message_id IS NOT NULL;
    ALTER TABLE humor_competitions DROP COLUMN message_id;
  END IF;
END $$;

-- If the old image_url column exists, migrate data to source_image_url then drop it
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'humor_competitions' AND column_name = 'image_url'
  ) THEN
    UPDATE humor_competitions SET source_image_url = image_url WHERE source_image_url IS NULL AND image_url IS NOT NULL;
    ALTER TABLE humor_competitions DROP COLUMN image_url;
  END IF;
END $$;

-- If the old posted_by column exists, migrate data to source_posted_by then drop it
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'humor_competitions' AND column_name = 'posted_by'
  ) THEN
    UPDATE humor_competitions SET source_posted_by = posted_by WHERE source_posted_by IS NULL AND posted_by IS NOT NULL;
    ALTER TABLE humor_competitions DROP COLUMN posted_by;
  END IF;
END $$;
