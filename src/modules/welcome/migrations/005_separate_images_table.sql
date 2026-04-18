-- Welcome Module - Separate images into their own table
-- Allows multiple images per user and regeneration history

-- Create the images table
CREATE TABLE IF NOT EXISTS welcome_images (
  id VARCHAR(36) PRIMARY KEY,
  guild_id VARCHAR(20) NOT NULL,
  user_id VARCHAR(20) NOT NULL,
  image_path VARCHAR(512) NOT NULL,
  prompt_index INT,
  prompt_text TEXT,
  model VARCHAR(50) NOT NULL,
  cost DECIMAL(10, 4) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_welcome_images_guild ON welcome_images (guild_id);
CREATE INDEX IF NOT EXISTS idx_welcome_images_user ON welcome_images (user_id);
CREATE INDEX IF NOT EXISTS idx_welcome_images_guild_user ON welcome_images (guild_id, user_id);
CREATE INDEX IF NOT EXISTS idx_welcome_images_created ON welcome_images (created_at);

-- Add image_id column to welcome_history (references welcome_images)
ALTER TABLE welcome_history
ADD COLUMN image_id VARCHAR(36);

-- Add index for the foreign key
CREATE INDEX IF NOT EXISTS idx_welcome_history_image_id ON welcome_history (image_id);

-- Note: Existing columns (image_path, image_prompt_index, etc.) are kept for backward compatibility
-- They can be removed in a future migration after data is migrated
