# PostgreSQL Lock Reference for LockSmith Rules LS001-LS012

> Bob reads this document before rewriting any migration.
> "Rewrite?" = does PostgreSQL rewrite the entire heap file?
> "Scan?" = does PostgreSQL perform a full sequential scan?
> Lock modes in ascending strength: AccessShare < RowShare < RowExclusive
>   < ShareUpdateExclusive < Share < ShareRowExclusive
>   < Exclusive < AccessExclusive

---

## Quick lookup: statement -> lock -> danger -> safe alternative

| Rule | Statement | Lock Acquired | Rewrite? | Scan? | Danger | Safe Alternative |
|------|-----------|---------------|----------|-------|--------|-----------------|
| LS001 | `CREATE INDEX` (no CONCURRENTLY) | AccessExclusive | No | Yes (full seq scan while held) | Blocks all reads + writes for the scan duration; critical on tables > 1M rows | `CREATE INDEX CONCURRENTLY` in its own file with `-- locksmith:no-transaction` (no transaction block). No lock_timeout needed; CONCURRENTLY uses ShareUpdateExclusive only during build. |
| LS002 | `ADD COLUMN col NOT NULL` (no DEFAULT) | AccessExclusive | No* | No | Fails immediately on non-empty tables (constraint violation) | (1) `ADD COLUMN col TYPE DEFAULT NULL`; (2) batch backfill `UPDATE … SET col = val WHERE id BETWEEN lo AND hi`; (3) `ADD CONSTRAINT chk CHECK (col IS NOT NULL) NOT VALID`; (4) `VALIDATE CONSTRAINT chk` (ShareUpdateExclusive, non-blocking); (5) `ALTER COLUMN col SET NOT NULL`; (6) `DROP CONSTRAINT chk`. |
| LS003 | `ADD COLUMN col DEFAULT <volatile>` e.g. `now()`, `gen_random_uuid()` | AccessExclusive | Yes (PG < 11) / No (PG 11+ with constant default) | No | Volatile default forces full heap rewrite; long AccessExclusive on large tables | (1) `ADD COLUMN col TYPE DEFAULT NULL`; (2) `ALTER COLUMN col SET DEFAULT now()`; (3) batch backfill to set existing rows; row-level default takes effect at insert time without rewrite. |
| LS004 | `ALTER COLUMN col TYPE newtype` | AccessExclusive | Yes | No | Full table rewrite under AccessExclusive; critical on > 1M rows | (1) `ADD COLUMN col_new newtype`; (2) app dual-write: write both `col` (old) and `col_new` (new); (3) batch backfill `col_new = CAST(col AS newtype)` in ranges; (4) app read from `col_new`; (5) `DROP COLUMN col`; (6) `RENAME COLUMN col_new TO col`. |
| LS005 | `ALTER COLUMN col SET NOT NULL` | AccessExclusive | No | Yes (validates every row) | Full sequential scan under AccessExclusive | (1) `ADD CONSTRAINT chk_nn CHECK (col IS NOT NULL) NOT VALID`; (2) `VALIDATE CONSTRAINT chk_nn` (ShareUpdateExclusive); (3) `ALTER COLUMN col SET NOT NULL`; (4) `DROP CONSTRAINT chk_nn`. PG 12+ can use NOT VALID approach to skip the full scan at SET NOT NULL. |
| LS006 | `ADD CONSTRAINT fk FOREIGN KEY` (no NOT VALID) | ShareRowExclusive on referencing table + AccessShare on referenced table | No | Yes (validates all rows) | Holds ShareRowExclusive while scanning the whole table; blocks concurrent writes | `ADD CONSTRAINT fk FOREIGN KEY … NOT VALID;` (instant, no scan) then in a separate migration: `VALIDATE CONSTRAINT fk;` (ShareUpdateExclusive, non-blocking). |
| LS007 | `ADD CONSTRAINT chk CHECK` (no NOT VALID) | AccessExclusive | No | Yes | Full sequential scan under AccessExclusive | Same split: `ADD CONSTRAINT … CHECK … NOT VALID;` then `VALIDATE CONSTRAINT …;` in a later migration. |
| LS008 | `RENAME COLUMN old TO new` while app still reads `old` | AccessExclusive | No | No | Instant lock but app breaks immediately if it still references old name | Expand/contract: (1) `ADD COLUMN new TYPE`; (2) app dual-write; (3) backfill; (4) app reads from `new`; (5) deploy; (6) `DROP COLUMN old`. Never rename while app code references the old name. |
| LS009 | `DROP COLUMN` / `DROP TABLE` while app still references it | AccessExclusive | No (column mark) / Yes (table) | No | App immediately throws "column does not exist" | Remove all app code references first, deploy that version, confirm no references remain, then issue the DROP in a subsequent migration. |
| LS010 | Any AccessExclusive DDL without `SET lock_timeout` | AccessExclusive (statement-specific) | — | — | Statement queues behind long transactions and then blocks every query behind it (lock queue pile-up). Without a timeout it waits indefinitely. | Add `SET lock_timeout = '3s';` as the very first statement in the migration. Add application-level retry logic (catch `lock_not_available` / `55P03`). |
| LS011 | `CREATE INDEX CONCURRENTLY` mixed with other statements or inside a transaction | Fails with ERROR | — | — | PostgreSQL does not allow CONCURRENTLY inside a transaction or alongside other statements; the migration errors out | Isolate into its own file, starting with `-- locksmith:no-transaction`. The CLI runner must execute this file outside a `BEGIN/COMMIT` wrapper. |
| LS012 | `UPDATE table SET …` or `DELETE FROM table` without a key-range `WHERE` clause | RowExclusive (row-level) but holds ShareLock on the table page chain | No | Yes (full table) | Acquires a large number of row locks; with no WHERE or unbounded WHERE the entire table is locked for the duration; can OOM and timeout | Rewrite as a batched loop outside the schema migration: `DO $$ DECLARE lo BIGINT := 0; hi BIGINT; LOOP SELECT MAX(id) INTO hi FROM t WHERE id > lo AND id <= lo+10000; EXIT WHEN hi IS NULL; UPDATE t SET … WHERE id BETWEEN lo AND hi; lo := hi; COMMIT; END LOOP; $$`. Move to a separate backfill file. |

---

## Lock mode cheat-sheet

| Lock Mode | Conflicts with | Typical statements |
|-----------|---------------|-------------------|
| AccessShare | AccessExclusive only | `SELECT` |
| RowShare | Exclusive, AccessExclusive | `SELECT … FOR UPDATE/SHARE` |
| RowExclusive | Share, ShareRowExclusive, Exclusive, AccessExclusive | `INSERT`, `UPDATE`, `DELETE` |
| ShareUpdateExclusive | ShareUpdateExclusive, Share, ShareRowExclusive, Exclusive, AccessExclusive | `VACUUM`, `ANALYZE`, `CREATE INDEX CONCURRENTLY`, `VALIDATE CONSTRAINT` |
| Share | RowExclusive, ShareRowExclusive, Exclusive, AccessExclusive | `CREATE INDEX` (non-concurrent) |
| ShareRowExclusive | RowExclusive, ShareUpdateExclusive, Share, ShareRowExclusive, Exclusive, AccessExclusive | `ADD CONSTRAINT … FOREIGN KEY` (validating) |
| Exclusive | RowShare, RowExclusive, ShareUpdateExclusive, Share, ShareRowExclusive, Exclusive, AccessExclusive | Rare DDL |
| AccessExclusive | All | `ALTER TABLE`, `DROP TABLE`, `DROP INDEX`, `TRUNCATE`, `LOCK TABLE`, `CREATE INDEX`, `REINDEX` |

**Key insight — lock queue pile-up:** Even an instant `ALTER TABLE` that normally takes milliseconds
will queue behind a long-running `SELECT`. While it waits, every subsequent query (reads included)
queues behind the `ALTER TABLE`. Setting `lock_timeout = '3s'` causes the DDL to abort rather than
wait, which prevents the pile-up. Always set it; always retry on `lock_not_available` (SQLSTATE `55P03`).

---

## Expand / Contract pattern (canonical form)

```
Phase 1 — EXPAND  (one migration, non-breaking deploy)
  - Add new column / table / index (all nullable, with defaults)
  - Update application: dual-write old + new column; read from new column
  - Deploy application

Phase 2 — BACKFILL  (separate migration file)
  - Batch UPDATE to populate new column from old
  - Batch size: 5000-10000 rows keyed by PK range
  - COMMIT after each batch (no long-held locks)

Phase 3 — CONTRACT  (one migration, after app is reading new column only)
  - Set NOT NULL constraint via NOT VALID + VALIDATE
  - Drop old column / table / index
  - Remove dual-write from application
  - Deploy application

Phase 4 — VERIFY
  - Re-run: npm run locksmith -- --dir <repo> --json locksmith-report.json
  - Gate must pass: exit 0, no critical findings, risk scores reduced
```

---

## Naming convention for split migrations

When one original file must be split into multiple files, use letter suffixes
to maintain ordering without renumbering later migrations:

```
Original:  002_orders_customer_index.sql  (flagged LS001 + LS010)

Split into:
  002a_orders_customer_index_expand.sql    -- SET lock_timeout; safe DDL (LS010 fixed)
  002b_orders_customer_index_conc.sql      -- locksmith:no-transaction; CREATE INDEX CONCURRENTLY (LS001 fixed)
  002c_orders_customer_backfill.sql        -- data backfill if needed
  002d_orders_customer_contract.sql        -- SET NOT NULL, DROP old col, etc.
```

Letter suffixes sort lexicographically before `003_…` so migration order is preserved.
