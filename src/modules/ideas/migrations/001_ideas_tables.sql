-- Ideas Module: Collaborative idea management with AI features
-- Uses Discord Forum channels for native idea/thread experience

-- Main ideas table (tracks forum posts)
CREATE TABLE IF NOT EXISTS ideas_ideas (
  id VARCHAR(36) PRIMARY KEY,
  guild_id VARCHAR(20) NOT NULL,
  channel_id VARCHAR(20) NOT NULL,
  thread_id VARCHAR(20) NOT NULL UNIQUE,
  message_id VARCHAR(20) NOT NULL,
  author_id VARCHAR(20) NOT NULL,
  title VARCHAR(200) NOT NULL,
  content TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  approved_by VARCHAR(20),
  approved_at TIMESTAMP NULL,
  implemented_at TIMESTAMP NULL,
  ai_summary TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ideas_ideas_guild ON ideas_ideas (guild_id);
CREATE INDEX IF NOT EXISTS idx_ideas_ideas_status ON ideas_ideas (guild_id, status);
CREATE INDEX IF NOT EXISTS idx_ideas_ideas_thread ON ideas_ideas (thread_id);
CREATE INDEX IF NOT EXISTS idx_ideas_ideas_author ON ideas_ideas (author_id);

-- Suggestions within idea threads
CREATE TABLE IF NOT EXISTS ideas_suggestions (
  id VARCHAR(36) PRIMARY KEY,
  idea_id VARCHAR(36) NOT NULL,
  message_id VARCHAR(20) NOT NULL UNIQUE,
  author_id VARCHAR(20) NOT NULL,
  content TEXT NOT NULL,
  upvotes INT DEFAULT 0,
  downvotes INT DEFAULT 0,
  is_incorporated BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (idea_id) REFERENCES ideas_ideas(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ideas_suggestions_idea ON ideas_suggestions (idea_id);
CREATE INDEX IF NOT EXISTS idx_ideas_suggestions_votes ON ideas_suggestions (idea_id, upvotes DESC);

-- Vote tracking to prevent double voting
CREATE TABLE IF NOT EXISTS ideas_votes (
  id SERIAL PRIMARY KEY,
  suggestion_id VARCHAR(36) NOT NULL,
  user_id VARCHAR(20) NOT NULL,
  vote_type TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (suggestion_id, user_id),
  FOREIGN KEY (suggestion_id) REFERENCES ideas_suggestions(id) ON DELETE CASCADE
);

-- Guild configuration (stores forum channel ID)
CREATE TABLE IF NOT EXISTS ideas_config (
  guild_id VARCHAR(20) PRIMARY KEY,
  forum_channel_id VARCHAR(20),
  vote_threshold INT DEFAULT 5,
  auto_track_suggestions BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
