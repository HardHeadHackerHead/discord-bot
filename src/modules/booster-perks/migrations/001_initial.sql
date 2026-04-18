-- Booster Perks module - tracks custom assets (sounds, emojis, etc.) per booster

CREATE TABLE IF NOT EXISTS boosterperks_assets (
  id VARCHAR(36) PRIMARY KEY,
  guild_id VARCHAR(20) NOT NULL,
  user_id VARCHAR(20) NOT NULL,
  asset_type TEXT NOT NULL,
  asset_id VARCHAR(20) NOT NULL,
  asset_name VARCHAR(32) NOT NULL,
  original_url TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_boosterperks_assets_guild_user_type ON boosterperks_assets (guild_id, user_id, asset_type);
CREATE INDEX IF NOT EXISTS idx_boosterperks_assets_asset_id ON boosterperks_assets (asset_id);
