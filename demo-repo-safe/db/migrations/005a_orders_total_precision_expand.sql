SET lock_timeout = '3s';
-- Expand: add total_new column with target precision type (no rewrite)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS total_new numeric(12,2) DEFAULT NULL;
