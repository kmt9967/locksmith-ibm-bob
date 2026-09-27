-- Validate foreign key constraint (ShareUpdateExclusive — allows concurrent reads and most writes)
ALTER TABLE order_items VALIDATE CONSTRAINT fk_order_items_order;
