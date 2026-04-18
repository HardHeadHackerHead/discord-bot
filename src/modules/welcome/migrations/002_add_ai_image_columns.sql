-- Welcome Module - Add AI image generation columns
-- Adds columns for DALL-E image generation feature

ALTER TABLE welcome_guild_settings
ADD COLUMN use_ai_image BOOLEAN DEFAULT FALSE;

ALTER TABLE welcome_guild_settings
ADD COLUMN ai_image_prompt TEXT;
