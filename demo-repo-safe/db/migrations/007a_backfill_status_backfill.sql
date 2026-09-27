-- Backfill NULL status rows in batches (RowExclusiveLock per batch — no pile-up risk)
DO $$
DECLARE
  lo BIGINT := 0;
  hi BIGINT;
BEGIN
  LOOP
    SELECT MAX(id) INTO hi FROM orders WHERE id > lo AND id <= lo + 10000;
    EXIT WHEN hi IS NULL;
    UPDATE orders
    SET status = 'pending'
    WHERE id BETWEEN lo + 1 AND hi
      AND status IS NULL;
    lo := hi;
    COMMIT;
  END LOOP;
END $$;
