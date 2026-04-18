-- Ideas Module: Token system and suggestion approval workflow
-- Adds:
-- 1. Bot message tracking for editable AI message
-- 2. AI result caching to avoid redundant API calls
-- 3. Suggestion approval status (only approved suggestions in AI analysis)
-- 4. Token system per-idea for rate limiting AI features

-- Add bot message tracking and AI caching to ideas table
ALTER TABLE ideas_ideas
  ADD COLUMN bot_message_id VARCHAR(20) NULL,
  ADD COLUMN ai_summarize_cache TEXT NULL,
  ADD COLUMN ai_expand_cache TEXT NULL,
  ADD COLUMN ai_issues_cache TEXT NULL,
  ADD COLUMN ai_cache_updated_at TIMESTAMP NULL,
  ADD COLUMN last_suggestion_approved_at TIMESTAMP NULL,
  ADD COLUMN tokens_used INT DEFAULT 0,
  ADD COLUMN tokens_max INT DEFAULT 10,
  ADD COLUMN tokens_reset_at TIMESTAMP NULL;

-- Add approval status to suggestions
ALTER TABLE ideas_suggestions
  ADD COLUMN status TEXT DEFAULT 'pending',
  ADD COLUMN approved_by VARCHAR(20) NULL,
  ADD COLUMN approved_at TIMESTAMP NULL;

-- Index for finding ideas needing token reset
CREATE INDEX idx_tokens_reset ON ideas_ideas (guild_id, tokens_reset_at);
