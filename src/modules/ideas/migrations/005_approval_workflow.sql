-- Ideas Module: Enhanced approval workflow
-- Adds new statuses for tracking idea progress after submission
-- Statuses: submitted, under_review, approved, rejected, in_progress, implemented

-- Update status column - in PostgreSQL we just use TEXT, no ENUM modification needed
-- The column is already TEXT from the initial migration conversion
-- No type change needed since we converted ENUM to TEXT

-- Add column to track who changed the status and when
ALTER TABLE ideas_ideas
  ADD COLUMN status_changed_by VARCHAR(20) NULL,
  ADD COLUMN status_changed_at TIMESTAMP NULL;

-- Add column to store admin notes about the status
ALTER TABLE ideas_ideas
  ADD COLUMN admin_notes TEXT NULL;
