-- Lab info messages tracking (for smart updates)
CREATE TABLE IF NOT EXISTS lab_info_messages (
  id VARCHAR(36) PRIMARY KEY,
  guild_id VARCHAR(20) NOT NULL UNIQUE,
  channel_id VARCHAR(20) NOT NULL,
  message_id VARCHAR(20) NOT NULL,
  content_hash VARCHAR(32) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_lab_info_messages_guild ON lab_info_messages (guild_id);
