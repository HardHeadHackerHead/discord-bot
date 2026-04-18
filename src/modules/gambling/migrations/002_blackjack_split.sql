-- Add split hand support to blackjack games

-- Add columns for split functionality
ALTER TABLE gambling_blackjack_games
  ADD COLUMN split_hand JSONB DEFAULT NULL,
  ADD COLUMN split_bet_amount BIGINT DEFAULT 0,
  ADD COLUMN current_hand TEXT DEFAULT 'main',
  ADD COLUMN main_hand_status TEXT DEFAULT 'playing',
  ADD COLUMN split_hand_status TEXT DEFAULT NULL,
  ADD COLUMN has_split BOOLEAN DEFAULT FALSE;
