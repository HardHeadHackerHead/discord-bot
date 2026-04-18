-- Welcome Module - Add image tracking columns
-- Stores prompt info and cost for analytics and debugging

ALTER TABLE welcome_history
ADD COLUMN image_prompt_index INT;

ALTER TABLE welcome_history
ADD COLUMN image_prompt_text TEXT;

ALTER TABLE welcome_history
ADD COLUMN image_model VARCHAR(50);

ALTER TABLE welcome_history
ADD COLUMN image_cost DECIMAL(10, 4);
