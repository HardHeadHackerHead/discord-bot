-- Ideas Module: Multi-vote support
-- Moves voting tracking from ideas table to suggestions table
-- Allows multiple suggestions to have active votes simultaneously

-- Add voting columns to suggestions table
ALTER TABLE ideas_suggestions
  ADD COLUMN is_voting_active BOOLEAN DEFAULT FALSE,
  ADD COLUMN vote_announcement_message_id VARCHAR(20) NULL;

-- Index for finding active votes
CREATE INDEX idx_suggestions_voting ON ideas_suggestions (idea_id, is_voting_active);

-- Migrate existing active vote from ideas table to suggestions table
UPDATE ideas_suggestions s
SET is_voting_active = TRUE,
    vote_announcement_message_id = i.vote_announcement_message_id
FROM ideas_ideas i
WHERE s.id = i.voting_suggestion_id
  AND i.voting_suggestion_id IS NOT NULL;

-- Note: We keep voting_suggestion_id and vote_announcement_message_id on ideas table
-- for backwards compatibility, but they are now deprecated.
-- They can be removed in a future migration.
