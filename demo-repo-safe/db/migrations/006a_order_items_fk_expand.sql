SET lock_timeout = '3s';
-- Enforce referential integrity for line items (NOT VALID skips existing row scan)
ALTER TABLE order_items
  ADD CONSTRAINT fk_order_items_order FOREIGN KEY (order_id) REFERENCES orders (id) NOT VALID;
