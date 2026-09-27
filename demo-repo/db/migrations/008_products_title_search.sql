-- Product search (small table, already safe)
CREATE INDEX CONCURRENTLY idx_products_title ON products (title);
