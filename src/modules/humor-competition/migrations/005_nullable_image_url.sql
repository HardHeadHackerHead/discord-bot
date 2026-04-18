-- image_url is null until a trusted user posts the source image

ALTER TABLE humor_competitions ALTER COLUMN image_url DROP NOT NULL;
