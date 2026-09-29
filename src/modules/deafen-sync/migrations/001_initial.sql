-- Deafen Sync module - users whose client deafen is mirrored as a server deafen

CREATE TABLE IF NOT EXISTS deafensync_users (
  guild_id VARCHAR(20) NOT NULL,
  user_id VARCHAR(20) NOT NULL,
  added_by VARCHAR(20) NOT NULL,
  -- FALSE = removed from the list, but still server-deafened by us; the row
  -- is kept so we can lift the deafen when they next join voice
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  -- TRUE while the current server deafen was applied by this module
  bot_deafened BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (guild_id, user_id)
);
