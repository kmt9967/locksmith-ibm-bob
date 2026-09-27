-- locksmith:no-transaction
-- Speed up "my orders" page
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_customer_id ON orders (customer_id);
