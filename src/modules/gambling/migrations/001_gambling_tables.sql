-- Gambling Module Tables
-- Tracks gambling statistics, history, and user data

-- User gambling statistics per guild
CREATE TABLE IF NOT EXISTS gambling_user_stats (
  id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(20) NOT NULL,
  guild_id VARCHAR(20) NOT NULL,

  -- Overall stats
  total_bets INT DEFAULT 0,
  total_wagered BIGINT DEFAULT 0,
  total_won BIGINT DEFAULT 0,
  total_lost BIGINT DEFAULT 0,
  net_profit BIGINT DEFAULT 0,
  biggest_win BIGINT DEFAULT 0,
  biggest_loss BIGINT DEFAULT 0,
  current_streak INT DEFAULT 0,  -- Positive = win streak, negative = loss streak
  best_win_streak INT DEFAULT 0,
  worst_loss_streak INT DEFAULT 0,

  -- Per-game stats (wins/losses)
  coinflip_wins INT DEFAULT 0,
  coinflip_losses INT DEFAULT 0,
  slots_wins INT DEFAULT 0,
  slots_losses INT DEFAULT 0,
  roulette_wins INT DEFAULT 0,
  roulette_losses INT DEFAULT 0,
  blackjack_wins INT DEFAULT 0,
  blackjack_losses INT DEFAULT 0,
  blackjack_pushes INT DEFAULT 0,

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  UNIQUE (user_id, guild_id)
);

CREATE INDEX IF NOT EXISTS idx_gambling_user_stats_guild ON gambling_user_stats (guild_id);
CREATE INDEX IF NOT EXISTS idx_gambling_user_stats_net_profit ON gambling_user_stats (net_profit DESC);
CREATE INDEX IF NOT EXISTS idx_gambling_user_stats_total_wagered ON gambling_user_stats (total_wagered DESC);

-- Gambling transaction history
CREATE TABLE IF NOT EXISTS gambling_history (
  id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(20) NOT NULL,
  guild_id VARCHAR(20) NOT NULL,

  game_type TEXT NOT NULL,
  bet_amount BIGINT NOT NULL,
  outcome TEXT NOT NULL,
  payout BIGINT NOT NULL,  -- Negative for losses, positive for wins
  multiplier DECIMAL(10, 2) DEFAULT 0,  -- e.g., 2.0 for 2x win

  -- Game-specific data stored as JSONB
  game_data JSONB,

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_gambling_history_user_guild ON gambling_history (user_id, guild_id);
CREATE INDEX IF NOT EXISTS idx_gambling_history_game_type ON gambling_history (game_type);
CREATE INDEX IF NOT EXISTS idx_gambling_history_created_at ON gambling_history (created_at DESC);

-- Active blackjack games (since blackjack requires multiple actions)
CREATE TABLE IF NOT EXISTS gambling_blackjack_games (
  id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(20) NOT NULL,
  guild_id VARCHAR(20) NOT NULL,
  channel_id VARCHAR(20) NOT NULL,
  message_id VARCHAR(20),

  bet_amount BIGINT NOT NULL,

  -- Card data stored as JSONB arrays
  player_hand JSONB NOT NULL,
  dealer_hand JSONB NOT NULL,
  deck JSONB NOT NULL,

  -- Game state
  status TEXT DEFAULT 'playing',

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NOT NULL,

  UNIQUE (user_id, guild_id)
);

CREATE INDEX IF NOT EXISTS idx_gambling_blackjack_games_expires ON gambling_blackjack_games (expires_at);
