-- Totals must support cents
ALTER TABLE orders ALTER COLUMN total TYPE numeric(12,2);
