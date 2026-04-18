-- Welcome Module - Initial schema
-- Stores guild welcome configurations and message history

-- Guild welcome settings
CREATE TABLE IF NOT EXISTS welcome_guild_settings (
  id VARCHAR(36) PRIMARY KEY,
  guild_id VARCHAR(20) NOT NULL UNIQUE,
  enabled BOOLEAN DEFAULT FALSE,
  welcome_channel_id VARCHAR(20),
  send_dm BOOLEAN DEFAULT FALSE,
  message_template TEXT,
  embed_title VARCHAR(256),
  embed_description TEXT,
  embed_color VARCHAR(7) DEFAULT '#00D4FF',
  include_image BOOLEAN DEFAULT TRUE,
  mention_user BOOLEAN DEFAULT TRUE,
  use_ai_message BOOLEAN DEFAULT FALSE,
  ai_prompt_template TEXT,
  use_ai_image BOOLEAN DEFAULT FALSE,
  ai_image_prompt TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_welcome_guild_settings_guild ON welcome_guild_settings (guild_id);
CREATE INDEX IF NOT EXISTS idx_welcome_guild_settings_enabled ON welcome_guild_settings (enabled);

-- Welcome message history for analytics and debugging
CREATE TABLE IF NOT EXISTS welcome_history (
  id VARCHAR(36) PRIMARY KEY,
  guild_id VARCHAR(20) NOT NULL,
  user_id VARCHAR(20) NOT NULL,
  channel_id VARCHAR(20),
  message_id VARCHAR(20),
  sent_dm BOOLEAN DEFAULT FALSE,
  image_generated BOOLEAN DEFAULT FALSE,
  image_path VARCHAR(512),
  image_prompt_index INT,
  image_prompt_text TEXT,
  image_model VARCHAR(50),
  image_cost DECIMAL(10, 4),
  ai_message_generated BOOLEAN DEFAULT FALSE,
  ai_tokens_used INT DEFAULT 0,
  error_message TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_welcome_history_guild ON welcome_history (guild_id);
CREATE INDEX IF NOT EXISTS idx_welcome_history_user ON welcome_history (user_id);
CREATE INDEX IF NOT EXISTS idx_welcome_history_created ON welcome_history (created_at);
