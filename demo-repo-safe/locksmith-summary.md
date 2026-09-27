# LockSmith Audit Summary

**Repository:** `./demo-repo-safe` (Shopfront app — safe working copy)
**Date:** 2026-09-27
**Gate before:** ❌ FAIL  **Gate after:** ✅ PASS
**Risk score before:** 100 / 100  **Risk score after:** 40 / 100

---

## Risk Score by Migration

| Migration (before) | Risk Before | Migration (after) | Risk After | Delta |
|--------------------|-------------|-------------------|------------|-------|
| `001_baseline.sql` | 0 | `001_baseline.sql` | 0 | 0 |
| `002_orders_customer_index.sql` | 100 | `002a_orders_customer_index_conc.sql` | 0 | **-100** |
| `003_orders_shipped_at.sql` | 100 | `003a_orders_shipped_at_expand.sql` | 0 | **-100** |
| _(split from 003)_ | | `003b_orders_shipped_at_backfill.sql` | 0 | |
| _(split from 003)_ | | `003c_orders_shipped_at_contract.sql` | 0 | |
| _(split from 003)_ | | `003d_orders_shipped_at_validate.sql` | 0 | |
| `004_rename_customer_email.sql` | 100 | `004a_rename_customer_email_expand.sql` | 0 | **-100** |
| `005_orders_total_precision.sql` | 100 | `005a_orders_total_precision_expand.sql` | 0 | **-100** |
| _(split from 005)_ | | `005b_orders_total_precision_backfill.sql` | 0 | |
| `006_order_items_fk.sql` | 55 | `006a_order_items_fk_expand.sql` | 0 | **-55** |
| _(split from 006)_ | | `006b_order_items_fk_validate.sql` | 0 | |
| `007_backfill_status.sql` | 95 | `007a_backfill_status_backfill.sql` | 0 | **-95** |
| _(split from 007)_ | | `007b_backfill_status_contract.sql` | 0 | |
| _(split from 007)_ | | `007c_backfill_status_validate.sql` | 40 | |
| `008_products_title_search.sql` | 0 | `008_products_title_search.sql` | 0 | 0 |

---

## Findings by Rule

| Rule | Severity | Count Before | Count After | Notes |
|------|----------|-------------|------------|-------|
| LS001 | critical | 1 | 0 | CREATE INDEX → CONCURRENTLY |
| LS002 | critical | 1 | 0 | ADD COLUMN NOT NULL → nullable + backfill + NOT VALID CHECK |
| LS003 | high | 1 | 0 | volatile DEFAULT → nullable column + SET DEFAULT + backfill |
| LS004 | critical | 1 | 0 | ALTER COLUMN TYPE → add new column + backfill + contract |
| LS005 | high | 1 | 1 | SET NOT NULL — see note below |
| LS006 | high | 1 | 0 | FK without NOT VALID → NOT VALID + VALIDATE separately |
| LS007 | — | 0 | 0 | — |
| LS008 | critical | 1 | 0 | RENAME while app references it → expand-only, no rename |
| LS009 | — | 0 | 0 | — |
| LS010 | medium | 6 | 0 | Missing lock_timeout → SET lock_timeout = '3s' in all DDL files |
| LS011 | — | 0 | 0 | — |
| LS012 | high | 1 | 0 | Un-batched UPDATE → batched PK-range loop |

> **LS005 residual (high, non-blocking gate):** `007c_backfill_status_validate.sql` contains
> `ALTER COLUMN status SET NOT NULL` after `VALIDATE CONSTRAINT chk_orders_status_not_null`.
> LockSmith's static probe fires regardless, but this is safe in PostgreSQL 12+: when a validated
> `CHECK (col IS NOT NULL)` constraint exists, the optimizer skips the full scan and the lock
> duration is microseconds. The gate threshold allows high findings to pass.

---

## Files Changed

| File | Action |
|------|--------|
| `db/migrations/002_orders_customer_index.sql` | deleted (replaced by 002a) |
| `db/migrations/002a_orders_customer_index_conc.sql` | created — `-- locksmith:no-transaction` + `CREATE INDEX CONCURRENTLY` |
| `db/migrations/003_orders_shipped_at.sql` | deleted (replaced by 003a–003d) |
| `db/migrations/003a_orders_shipped_at_expand.sql` | created — `SET lock_timeout` + ADD two nullable columns + SET DEFAULT |
| `db/migrations/003b_orders_shipped_at_backfill.sql` | created — batched PK-range backfill for `shipped_at` and `tracking_code` |
| `db/migrations/003c_orders_shipped_at_contract.sql` | created — ADD CONSTRAINT NOT VALID for both columns |
| `db/migrations/003d_orders_shipped_at_validate.sql` | created — VALIDATE CONSTRAINT (ShareUpdateExclusive) |
| `db/migrations/004_rename_customer_email.sql` | deleted (replaced by 004a) |
| `db/migrations/004a_rename_customer_email_expand.sql` | created — `SET lock_timeout` + ADD COLUMN `email_address` (expand only, no drop) |
| `db/migrations/005_orders_total_precision.sql` | deleted (replaced by 005a–005b) |
| `db/migrations/005a_orders_total_precision_expand.sql` | created — `SET lock_timeout` + ADD COLUMN `total_new numeric(12,2)` |
| `db/migrations/005b_orders_total_precision_backfill.sql` | created — batched PK-range CAST backfill `total → total_new` |
| `db/migrations/005c_orders_total_precision_contract.sql` | deferred — DROP old `total` + RENAME `total_new → total` (future release only; see notes) |
| `db/migrations/006_order_items_fk.sql` | deleted (replaced by 006a–006b) |
| `db/migrations/006a_order_items_fk_expand.sql` | created — `SET lock_timeout` + ADD CONSTRAINT FK NOT VALID |
| `db/migrations/006b_order_items_fk_validate.sql` | created — VALIDATE CONSTRAINT (ShareUpdateExclusive) |
| `db/migrations/007_backfill_status.sql` | deleted (replaced by 007a–007c) |
| `db/migrations/007a_backfill_status_backfill.sql` | created — batched PK-range UPDATE for NULL status rows |
| `db/migrations/007b_backfill_status_contract.sql` | created — `SET lock_timeout` + ADD CONSTRAINT NOT VALID |
| `db/migrations/007c_backfill_status_validate.sql` | created — VALIDATE + `SET lock_timeout` + SET NOT NULL + DROP CONSTRAINT |
| `src/customers.ts` | updated — dual-write `email` + `email_address`; read via `COALESCE(email_address, email)` |
| `src/orders.ts` | updated — dual-write `total` + `total_new`; SELECT reads `total_new AS total` |

---

## Deployment Order

The team MUST deploy these phases in order and confirm each before proceeding:

### Phase 1 — Expand (deploy together as one migration set)
Run migrations in this order:
1. `001_baseline.sql`
2. `002a_orders_customer_index_conc.sql`  ← runner must execute **outside a transaction** (`-- locksmith:no-transaction`)
3. `003a_orders_shipped_at_expand.sql`
4. `004a_rename_customer_email_expand.sql`
5. `005a_orders_total_precision_expand.sql`
6. `006a_order_items_fk_expand.sql`
7. `007b_backfill_status_contract.sql`
8. `008_products_title_search.sql`

### Phase 2 — Deploy application (BEFORE running backfill migrations)
Deploy the updated application code (`src/customers.ts`, `src/orders.ts`) that dual-writes to both old and new columns and reads from the new columns. **Confirm all instances are on the new version.**

### Phase 3 — Backfill (safe to run online after app deploy)
Run in order:
1. `003b_orders_shipped_at_backfill.sql`
2. `005b_orders_total_precision_backfill.sql`
3. `007a_backfill_status_backfill.sql`

### Phase 4 — Contract (validate constraints, non-blocking)
Run in order:
1. `003c_orders_shipped_at_contract.sql`
2. `003d_orders_shipped_at_validate.sql`
3. `006b_order_items_fk_validate.sql`
4. `007c_backfill_status_validate.sql`

### Phase 5 — Future release: total column swap (deferred)
Only after confirming Phase 4 is stable and `total_new` is fully populated:
1. Remove all `total` (old column) references from `src/orders.ts`
2. Deploy the application
3. Run `005c_orders_total_precision_contract.sql` (DROP COLUMN total + RENAME total_new → total)

### Phase 6 — Future release: email column drop (deferred)
Only after confirming all app instances read from `email_address` and no code references `email`:
1. Remove all `email` (old column) references from `src/customers.ts`
2. Deploy the application
3. Run a new migration: `ALTER TABLE customers DROP COLUMN email;`

---

## Notes

- **`002a` must run outside a transaction.** The migration runner must detect the `-- locksmith:no-transaction` comment and execute this file without `BEGIN`/`COMMIT` wrapping. `CREATE INDEX CONCURRENTLY` is illegal inside a transaction block.
- **`005c` is intentionally excluded from this release.** The `DROP COLUMN total` + `RENAME COLUMN total_new` contract phase can only run after the application no longer writes to the old `total` column. Running it prematurely with app code still writing `total` would cause runtime errors.
- **`007c` LS005 residual:** The `ALTER COLUMN status SET NOT NULL` in `007c` is flagged by LockSmith's static probe but is safe in PostgreSQL 12+. The validated `CHECK (status IS NOT NULL)` constraint (added and validated earlier in the same file) tells the optimizer to skip the full scan. The lock is held for microseconds, not seconds.
- **Retry on lock_timeout:** All DDL files with `SET lock_timeout = '3s'` may abort with `SQLSTATE 55P03 (lock_not_available)` if a long-running query is active. Add retry logic (exponential back-off, up to 3 attempts) in the migration runner or CI pipeline.
