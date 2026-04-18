-- Cached track metadata from streaming provider
CREATE TABLE IF NOT EXISTS music_tracks (
  id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id VARCHAR(255) NOT NULL,
  provider VARCHAR(50) NOT NULL DEFAULT 'default',
  title VARCHAR(500) NOT NULL,
  artist VARCHAR(500) NOT NULL,
  album VARCHAR(500) DEFAULT NULL,
  duration INT NOT NULL DEFAULT 0,
  artwork_url VARCHAR(2048) DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  UNIQUE (external_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_music_tracks_title ON music_tracks (title);
CREATE INDEX IF NOT EXISTS idx_music_tracks_artist ON music_tracks (artist);

-- User playlists
CREATE TABLE IF NOT EXISTS music_playlists (
  id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(20) NOT NULL,
  guild_id VARCHAR(20) NOT NULL,
  name VARCHAR(100) NOT NULL,
  is_public BOOLEAN DEFAULT TRUE,
  track_count INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  UNIQUE (user_id, guild_id, name)
);

CREATE INDEX IF NOT EXISTS idx_music_playlists_guild ON music_playlists (guild_id);
CREATE INDEX IF NOT EXISTS idx_music_playlists_user_guild ON music_playlists (user_id, guild_id);

-- Playlist-to-track join table with position ordering
CREATE TABLE IF NOT EXISTS music_playlist_tracks (
  id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  playlist_id VARCHAR(36) NOT NULL,
  track_id VARCHAR(36) NOT NULL,
  position INT NOT NULL DEFAULT 0,
  added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  UNIQUE (playlist_id, track_id),
  FOREIGN KEY (playlist_id) REFERENCES music_playlists(id) ON DELETE CASCADE,
  FOREIGN KEY (track_id) REFERENCES music_tracks(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_music_playlist_tracks_playlist_position ON music_playlist_tracks (playlist_id, position);

-- Per-user per-guild track likes
CREATE TABLE IF NOT EXISTS music_likes (
  id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(20) NOT NULL,
  guild_id VARCHAR(20) NOT NULL,
  track_id VARCHAR(36) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  UNIQUE (user_id, guild_id, track_id),
  FOREIGN KEY (track_id) REFERENCES music_tracks(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_music_likes_track ON music_likes (track_id);
CREATE INDEX IF NOT EXISTS idx_music_likes_user_guild ON music_likes (user_id, guild_id);

-- Play history: every play event
CREATE TABLE IF NOT EXISTS music_play_history (
  id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  track_id VARCHAR(36) NOT NULL,
  guild_id VARCHAR(20) NOT NULL,
  user_id VARCHAR(20) NOT NULL,
  channel_id VARCHAR(20) NOT NULL,
  duration_listened INT DEFAULT 0,
  completed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (track_id) REFERENCES music_tracks(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_music_play_history_track ON music_play_history (track_id);
CREATE INDEX IF NOT EXISTS idx_music_play_history_guild ON music_play_history (guild_id);
CREATE INDEX IF NOT EXISTS idx_music_play_history_user_guild ON music_play_history (user_id, guild_id);
CREATE INDEX IF NOT EXISTS idx_music_play_history_created_at ON music_play_history (created_at DESC);

-- Aggregated per-track per-guild play counts
CREATE TABLE IF NOT EXISTS music_play_counts (
  id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  track_id VARCHAR(36) NOT NULL,
  guild_id VARCHAR(20) NOT NULL,
  play_count INT DEFAULT 0,
  total_listen_seconds BIGINT DEFAULT 0,
  last_played_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  UNIQUE (track_id, guild_id),
  FOREIGN KEY (track_id) REFERENCES music_tracks(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_music_play_counts_guild_play_count ON music_play_counts (guild_id, play_count DESC);

-- Aggregated per-user per-guild stats
CREATE TABLE IF NOT EXISTS music_user_stats (
  id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(20) NOT NULL,
  guild_id VARCHAR(20) NOT NULL,
  total_tracks_played INT DEFAULT 0,
  total_listen_seconds BIGINT DEFAULT 0,
  total_likes INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  UNIQUE (user_id, guild_id)
);

CREATE INDEX IF NOT EXISTS idx_music_user_stats_guild ON music_user_stats (guild_id);
CREATE INDEX IF NOT EXISTS idx_music_user_stats_listen_seconds ON music_user_stats (total_listen_seconds DESC);
