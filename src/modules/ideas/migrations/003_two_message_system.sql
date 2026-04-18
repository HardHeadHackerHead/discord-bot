-- Ideas Module: Two-message system and draft control panel
-- Adds:
-- 1. Second bot message ID for Message 2 (draft control panel)
-- 2. Current suggestion index for navigation
-- 3. Finalization status for ideas
-- 4. Draft summary for AI-generated concise drafts
-- 5. Voting suggestion ID to track which suggestion is being voted on
-- 6. Vote announcement message ID for cleanup

-- Add second message tracking, navigation, draft management
ALTER TABLE ideas_ideas
  ADD COLUMN bot_message_id_2 VARCHAR(20) NULL,
  ADD COLUMN current_suggestion_index INT DEFAULT 0,
  ADD COLUMN is_finalized BOOLEAN DEFAULT FALSE,
  ADD COLUMN draft_summary TEXT NULL,
  ADD COLUMN voting_suggestion_id VARCHAR(36) NULL,
  ADD COLUMN vote_announcement_message_id VARCHAR(20) NULL;

-- Index for finding finalized ideas
CREATE INDEX idx_ideas_finalized ON ideas_ideas (guild_id, is_finalized);

-- Update tokens_max default from 10 to 3
ALTER TABLE ideas_ideas
  ALTER COLUMN tokens_max SET DEFAULT 3;
