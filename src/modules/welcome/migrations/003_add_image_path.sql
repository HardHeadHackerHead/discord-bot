-- Welcome Module - Add image_path column to history
-- Stores the local file path for generated welcome images

ALTER TABLE welcome_history
ADD COLUMN image_path VARCHAR(512);
