-- Bankruptcy tracking
-- Tracks how many times a user has gone bankrupt (balance reaches 0)

ALTER TABLE gambling_user_stats
  ADD COLUMN IF NOT EXISTS bankruptcies INT DEFAULT 0;
