-- Website Integration Module - Sync History Table
-- Tracks sync operations for debugging and monitoring

CREATE TABLE IF NOT EXISTS website_sync_history (
  id VARCHAR(36) PRIMARY KEY,
  guild_id VARCHAR(20) NOT NULL,
  sync_type VARCHAR(50) NOT NULL,
  items_synced INT NOT NULL DEFAULT 0,
  success BOOLEAN NOT NULL DEFAULT TRUE,
  error_message VARCHAR(500) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_website_sync_history_guild_created ON website_sync_history (guild_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_website_sync_history_sync_type ON website_sync_history (sync_type, created_at DESC);
