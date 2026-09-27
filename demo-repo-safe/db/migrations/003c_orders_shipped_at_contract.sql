SET lock_timeout = '3s';
-- Add NOT NULL check constraints (NOT VALID = no full scan, ShareUpdateExclusive for VALIDATE)
ALTER TABLE orders ADD CONSTRAINT chk_orders_shipped_at_not_null
  CHECK (shipped_at IS NOT NULL) NOT VALID;
ALTER TABLE orders ADD CONSTRAINT chk_orders_tracking_code_not_null
  CHECK (tracking_code IS NOT NULL) NOT VALID;
