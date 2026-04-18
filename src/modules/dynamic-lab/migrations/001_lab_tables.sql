-- Dynamic Lab Module Tables

-- Lab creator channels (the "Get Lab Here" channels)
CREATE TABLE IF NOT EXISTS lab_creators (
  id VARCHAR(36) PRIMARY KEY,
  guild_id VARCHAR(20) NOT NULL,
  channel_id VARCHAR(20) NOT NULL UNIQUE,
  category_id VARCHAR(20),
  default_name VARCHAR(100) DEFAULT '@user''s Lab',
  default_user_limit INT DEFAULT 0,
  default_bitrate INT DEFAULT 64000,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_lab_creators_guild ON lab_creators (guild_id);
CREATE INDEX IF NOT EXISTS idx_lab_creators_channel ON lab_creators (channel_id);

-- Active lab channels (spawned channels)
CREATE TABLE IF NOT EXISTS lab_channels (
  id VARCHAR(36) PRIMARY KEY,
  channel_id VARCHAR(20) NOT NULL UNIQUE,
  guild_id VARCHAR(20) NOT NULL,
  creator_id VARCHAR(36) NOT NULL,
  owner_id VARCHAR(20) NOT NULL,
  name VARCHAR(100) NOT NULL,
  is_locked BOOLEAN DEFAULT FALSE,
  control_message_id VARCHAR(20),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_lab_channels_channel ON lab_channels (channel_id);
CREATE INDEX IF NOT EXISTS idx_lab_channels_owner ON lab_channels (owner_id);
CREATE INDEX IF NOT EXISTS idx_lab_channels_guild ON lab_channels (guild_id);

-- User preferences for their labs
CREATE TABLE IF NOT EXISTS lab_user_settings (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(20) NOT NULL,
  guild_id VARCHAR(20) NOT NULL,
  lab_name VARCHAR(100),
  user_limit INT DEFAULT 0,
  bitrate INT DEFAULT 64000,
  is_locked BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, guild_id)
);

CREATE INDEX IF NOT EXISTS idx_lab_user_settings_user ON lab_user_settings (user_id);

-- Permitted users for locked labs
CREATE TABLE IF NOT EXISTS lab_permitted_users (
  id VARCHAR(36) PRIMARY KEY,
  lab_channel_id VARCHAR(36) NOT NULL,
  user_id VARCHAR(20) NOT NULL,
  permitted_by VARCHAR(20) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (lab_channel_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_lab_permitted_users_lab ON lab_permitted_users (lab_channel_id);
