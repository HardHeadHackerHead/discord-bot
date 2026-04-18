-- Rock Paper Scissors challenges
CREATE TABLE IF NOT EXISTS gambling_rps_challenges (
  id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id VARCHAR(20) NOT NULL,
  channel_id VARCHAR(20) NOT NULL,
  message_id VARCHAR(20),

  challenger_id VARCHAR(20) NOT NULL,
  opponent_id VARCHAR(20) NOT NULL,
  bet_amount BIGINT NOT NULL,

  status TEXT DEFAULT 'pending', -- pending, accepted, completed, expired, declined, forfeited

  challenger_choice TEXT, -- rock, paper, scissors
  opponent_choice TEXT,

  winner_id VARCHAR(20),

  expires_at TIMESTAMP NOT NULL,
  choice_deadline TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_gambling_rps_status ON gambling_rps_challenges (status);
CREATE INDEX IF NOT EXISTS idx_gambling_rps_expires ON gambling_rps_challenges (expires_at);
CREATE INDEX IF NOT EXISTS idx_gambling_rps_choice_deadline ON gambling_rps_challenges (choice_deadline);

-- Add RPS stats columns to user stats
ALTER TABLE gambling_user_stats ADD COLUMN IF NOT EXISTS rps_wins INT DEFAULT 0;
ALTER TABLE gambling_user_stats ADD COLUMN IF NOT EXISTS rps_losses INT DEFAULT 0;
