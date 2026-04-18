-- The competitions table now starts in 'waiting' status with no source image.
-- posted_by is set later when a trusted user posts the source image.

ALTER TABLE humor_competitions ALTER COLUMN posted_by DROP NOT NULL;
