-- Module configuration per guild
-- Stores settings for how the module behaves when loaded/unloaded
CREATE TABLE IF NOT EXISTS lab_module_config (
  id VARCHAR(36) PRIMARY KEY,
  guild_id VARCHAR(20) NOT NULL UNIQUE,
  -- Category settings
  category_id VARCHAR(20),
  category_position INT DEFAULT 0,
  -- Cleanup behavior when module unloads
  -- 'keep' = keep channels, 'delete_labs' = delete active labs only, 'delete_all' = delete everything
  unload_behavior TEXT DEFAULT 'delete_labs',
  -- Whether to auto-create Get Lab Here channel on load
  auto_create_channel BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_lab_module_config_guild ON lab_module_config (guild_id);
