-- Social Feeds Module - Initial schema
-- Stores feed configurations and posted items to prevent duplicates

-- Feed configurations per guild
-- platform: 'youtube', 'twitch', etc. (extensible for future platforms)
-- platform_id: YouTube channel ID, Twitch username, etc.
CREATE TABLE IF NOT EXISTS socialfeeds_feed_configs (
  id VARCHAR(36) PRIMARY KEY,
  guild_id VARCHAR(20) NOT NULL,
  platform VARCHAR(50) NOT NULL,
  platform_id VARCHAR(255) NOT NULL,
  platform_name VARCHAR(255),
  channel_id VARCHAR(20) NOT NULL,
  custom_message TEXT,
  enabled BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (guild_id, platform, platform_id)
);

CREATE INDEX IF NOT EXISTS idx_socialfeeds_feed_configs_guild ON socialfeeds_feed_configs (guild_id);
CREATE INDEX IF NOT EXISTS idx_socialfeeds_feed_configs_platform ON socialfeeds_feed_configs (platform);
CREATE INDEX IF NOT EXISTS idx_socialfeeds_feed_configs_enabled ON socialfeeds_feed_configs (enabled);

-- Posted items to track what has been posted (prevent duplicates)
CREATE TABLE IF NOT EXISTS socialfeeds_posted_items (
  id VARCHAR(36) PRIMARY KEY,
  feed_config_id VARCHAR(36) NOT NULL,
  item_id VARCHAR(255) NOT NULL,
  title VARCHAR(500),
  url VARCHAR(500),
  posted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (feed_config_id, item_id),
  FOREIGN KEY (feed_config_id) REFERENCES socialfeeds_feed_configs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_socialfeeds_posted_items_feed_config ON socialfeeds_posted_items (feed_config_id);
CREATE INDEX IF NOT EXISTS idx_socialfeeds_posted_items_posted_at ON socialfeeds_posted_items (posted_at);

-- Guild settings for the social feeds module
CREATE TABLE IF NOT EXISTS socialfeeds_guild_settings (
  id VARCHAR(36) PRIMARY KEY,
  guild_id VARCHAR(20) NOT NULL UNIQUE,
  check_interval_minutes INT DEFAULT 15,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
