-- Resets module - per-guild alert channel and de-dup of already-announced resets

CREATE TABLE IF NOT EXISTS resets_alert_channels (
  guild_id VARCHAR(20) PRIMARY KEY,
  channel_id VARCHAR(20) NOT NULL,
  ping_role_id VARCHAR(20),
  claude_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  codex_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Global (not per guild): every reset we've already seen from a provider, so a
-- restart never re-announces history. Rows are seeded silently on first run.
CREATE TABLE IF NOT EXISTS resets_seen (
  provider VARCHAR(10) NOT NULL,
  event_id VARCHAR(80) NOT NULL,
  seen_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (provider, event_id)
);
