-- Multiplayer roulette tables

-- Active roulette games (one per voice channel)
CREATE TABLE IF NOT EXISTS gambling_roulette_games (
  id VARCHAR(36) PRIMARY KEY,
  guild_id VARCHAR(20) NOT NULL,
  channel_id VARCHAR(20) NOT NULL,
  voice_channel_id VARCHAR(20) NOT NULL,
  message_id VARCHAR(20) DEFAULT NULL,
  status TEXT DEFAULT 'betting',
  result_number INT DEFAULT NULL,
  result_color TEXT DEFAULT NULL,
  betting_ends_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  UNIQUE (voice_channel_id)
);

CREATE INDEX IF NOT EXISTS idx_gambling_roulette_games_guild ON gambling_roulette_games (guild_id);
CREATE INDEX IF NOT EXISTS idx_gambling_roulette_games_status ON gambling_roulette_games (status);

-- Individual bets placed on roulette games
CREATE TABLE IF NOT EXISTS gambling_roulette_bets (
  id VARCHAR(36) PRIMARY KEY,
  game_id VARCHAR(36) NOT NULL,
  user_id VARCHAR(20) NOT NULL,
  bet_type VARCHAR(20) NOT NULL,
  bet_number INT DEFAULT NULL,
  bet_amount BIGINT NOT NULL,
  payout BIGINT DEFAULT 0,
  outcome TEXT DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (game_id) REFERENCES gambling_roulette_games(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_gambling_roulette_bets_game ON gambling_roulette_bets (game_id);
CREATE INDEX IF NOT EXISTS idx_gambling_roulette_bets_user_game ON gambling_roulette_bets (user_id, game_id);
