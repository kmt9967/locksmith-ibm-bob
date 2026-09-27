-- Backfill total_new from total in batches
DO $$
DECLARE
  lo BIGINT := 0;
  hi BIGINT;
BEGIN
  LOOP
    SELECT MAX(id) INTO hi FROM orders WHERE id > lo AND id <= lo + 10000;
    EXIT WHEN hi IS NULL;
    UPDATE orders
    SET total_new = CAST(total AS numeric(12,2))
    WHERE id BETWEEN lo + 1 AND hi
      AND total_new IS NULL;
    lo := hi;
    COMMIT;
  END LOOP;
END $$;
