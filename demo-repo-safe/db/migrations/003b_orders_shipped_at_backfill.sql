-- Backfill shipped_at and tracking_code for existing rows
DO $$
DECLARE
  lo BIGINT := 0;
  hi BIGINT;
BEGIN
  LOOP
    SELECT MAX(id) INTO hi FROM orders WHERE id > lo AND id <= lo + 10000;
    EXIT WHEN hi IS NULL;
    UPDATE orders
    SET
      shipped_at = now(),
      tracking_code = ''
    WHERE id BETWEEN lo + 1 AND hi
      AND (shipped_at IS NULL OR tracking_code IS NULL);
    lo := hi;
    COMMIT;
  END LOOP;
END $$;
