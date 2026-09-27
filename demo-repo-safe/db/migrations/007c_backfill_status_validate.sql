SET lock_timeout = '3s';
-- Validate NOT NULL constraint (ShareUpdateExclusive — non-blocking)
ALTER TABLE orders VALIDATE CONSTRAINT chk_orders_status_not_null;
-- SET NOT NULL is instant in PG12+ when a validated CHECK constraint exists
ALTER TABLE orders ALTER COLUMN status SET NOT NULL;
ALTER TABLE orders DROP CONSTRAINT chk_orders_status_not_null;
