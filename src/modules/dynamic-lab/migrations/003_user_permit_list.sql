-- User's persistent permit list (stored per user, not per lab)
-- This list persists even when labs are destroyed and recreated
CREATE TABLE IF NOT EXISTS lab_user_permit_list (
  id VARCHAR(36) PRIMARY KEY,
  owner_id VARCHAR(20) NOT NULL,
  guild_id VARCHAR(20) NOT NULL,
  permitted_user_id VARCHAR(20) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (owner_id, guild_id, permitted_user_id)
);

CREATE INDEX IF NOT EXISTS idx_lab_user_permit_list_owner_guild ON lab_user_permit_list (owner_id, guild_id);
