SET lock_timeout = '3s';
-- Add NOT NULL check constraint (NOT VALID = no full scan under AccessExclusive)
ALTER TABLE orders ADD CONSTRAINT chk_orders_status_not_null
  CHECK (status IS NOT NULL) NOT VALID;
