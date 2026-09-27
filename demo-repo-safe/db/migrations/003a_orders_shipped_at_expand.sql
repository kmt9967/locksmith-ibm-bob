SET lock_timeout = '3s';
-- Track shipping time for the new fulfilment dashboard (expand: add columns nullable)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipped_at timestamptz DEFAULT NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tracking_code text DEFAULT NULL;
-- Set the future default for new rows (no rewrite)
ALTER TABLE orders ALTER COLUMN shipped_at SET DEFAULT now();
