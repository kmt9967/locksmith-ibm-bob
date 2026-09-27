-- Validate NOT NULL constraints (ShareUpdateExclusive — non-blocking)
ALTER TABLE orders VALIDATE CONSTRAINT chk_orders_shipped_at_not_null;
ALTER TABLE orders VALIDATE CONSTRAINT chk_orders_tracking_code_not_null;
