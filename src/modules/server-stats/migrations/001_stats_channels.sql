-- Server Stats Module: Tracks stat display channels
-- Each guild can have multiple stat channels (e.g., member count, online count, etc.)

CREATE TABLE IF NOT EXISTS serverstats_channels (
  id SERIAL PRIMARY KEY,
  guild_id VARCHAR(20) NOT NULL,
  channel_id VARCHAR(20) NOT NULL,
  stat_type TEXT NOT NULL DEFAULT 'members',
  name_template VARCHAR(100) NOT NULL DEFAULT 'Members: {count}',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (channel_id)
);

CREATE INDEX IF NOT EXISTS idx_serverstats_channels_guild ON serverstats_channels (guild_id);
CREATE INDEX IF NOT EXISTS idx_serverstats_channels_stat_type ON serverstats_channels (guild_id, stat_type);
