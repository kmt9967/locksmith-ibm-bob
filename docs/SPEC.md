# LockSmith — Product & Engine Specification

> Catch the migration that locks production — before you ship it.

## 1. Problem
Schema migrations are reviewed like normal code, but their danger is invisible in a diff.
On PostgreSQL, statements such as `CREATE INDEX` (no `CONCURRENTLY`), `ALTER COLUMN … TYPE`,
`ADD CONSTRAINT … FOREIGN KEY` (validated) or `SET NOT NULL` take locks that block reads or writes
for as long as a full table scan or rewrite takes. On a 40M-row table that is minutes of downtime.
Worse, even an *instant* `ACCESS EXCLUSIVE` DDL queues behind a long-running query and then blocks
every query queued behind it (lock queue pile-up) unless `lock_timeout` is set.
Reviewers must know these semantics by heart; misses cause outages, and the safe rewrite
(expand → backfill → contract) takes a senior engineer hours per migration.

## 2. Inputs
A repository containing:
- `db/migrations/*.sql` — ordered PostgreSQL migration files (filename prefix = order).
- `db/table-stats.json` — declared production size per table: `{ "orders": { "rows": 42000000, "writesPerSec": 350 } }`.
- application source (`src/**/*.ts`) — used to find code still referencing a renamed/dropped column.

## 3. Engine pipeline (`src/engine/`)
1. **Split** each migration into statements (respect `$$` bodies, strings, comments).
2. **Classify** each statement: kind (`ADD_COLUMN`, `CREATE_INDEX`, `ALTER_TYPE`, …), target table, columns.
3. **Rules** (deterministic, pure functions over the parsed statement + context) produce `Finding`s.
4. **Lock probe** (`src/engine/probe.ts`): replay all migrations in an embedded Postgres (PGlite),
   and for each statement run `BEGIN; <stmt>; SELECT locks FROM pg_locks WHERE pid = pg_backend_pid(); ROLLBACK;`
   (then re-apply it for real so later migrations see the schema). Record:
   - `locks`: relation → strongest lock mode actually acquired;
   - `rewrite`: whether the table's `pg_class.relfilenode` changed (⇒ full table rewrite);
   - `error`: statements that fail (e.g. `CREATE INDEX CONCURRENTLY` inside a transaction).
   Tables are seeded with a small synthetic row sample so constraint/NOT NULL checks execute.
5. **Impact**: `blocking = lock blocks writes (ShareLock or stronger) || blocks reads (AccessExclusive)`;
   `durationClass = rewrite ? "rewrite" : scans ? "scan" : "instant"`;
   `estSeconds` = rows / throughput constant per class (rewrite 150k rows/s, scan 1.5M rows/s, instant 0);
   `blockedWrites = estSeconds * writesPerSec`.
6. **Score**: per migration `riskScore 0–100`; repository gate fails if any finding has severity `critical`.

## 4. Rules (IDs are stable, used by the UI, CLI and Bob mode)
| ID | Detects | Severity | Safe pattern |
|---|---|---|---|
| LS001 | `CREATE INDEX` without `CONCURRENTLY` on an existing table | high (critical if rows > 1M) | `CREATE INDEX CONCURRENTLY` in its own non-transactional migration |
| LS002 | `ADD COLUMN … NOT NULL` without a constant `DEFAULT` | critical (fails on non-empty tables) | add nullable → backfill in batches → `SET NOT NULL` via `CHECK … NOT VALID` + `VALIDATE` |
| LS003 | `ADD COLUMN … DEFAULT <volatile>` (e.g. `now()`, `random()`, `gen_random_uuid()`) — forces rewrite | high | add column without default → set default → batch backfill |
| LS004 | `ALTER COLUMN … TYPE` (rewrite + ACCESS EXCLUSIVE) | critical if rows > 1M else high | new column + dual-write + backfill + swap |
| LS005 | `ALTER COLUMN … SET NOT NULL` on existing column (full scan under ACCESS EXCLUSIVE) | high | `ADD CONSTRAINT … CHECK (col IS NOT NULL) NOT VALID; VALIDATE CONSTRAINT; SET NOT NULL; DROP CONSTRAINT` |
| LS006 | `ADD CONSTRAINT … FOREIGN KEY` without `NOT VALID` | high | `NOT VALID` then `VALIDATE CONSTRAINT` in a separate migration |
| LS007 | `ADD CONSTRAINT … CHECK` without `NOT VALID` | medium | same as LS006 |
| LS008 | `RENAME COLUMN` / `RENAME TO` while application code still references the old name | critical | expand/contract: add new column, dual-write, migrate reads, drop old later |
| LS009 | `DROP COLUMN` / `DROP TABLE` while application code still references it | critical | remove code references first, deploy, then drop |
| LS010 | migration with ACCESS EXCLUSIVE statements but no `SET lock_timeout` | medium | `SET lock_timeout = '3s';` at top of migration + retry |
| LS011 | `CREATE INDEX CONCURRENTLY` mixed with other statements / inside a transaction | high (migration will fail) | isolate into its own migration without a transaction |
| LS012 | un-batched `UPDATE`/`DELETE` of a whole table (no `WHERE`, or `WHERE` without key range) | high | batched backfill job (`WHERE id BETWEEN …`), outside the schema migration |

A `Finding` = `{ ruleId, severity, migration, statementIndex, line, table, message, why, safePattern, evidence?: { locks, rewrite }, impact?: { estSeconds, blockedWrites } }`.

## 5. IBM Bob integration (core component)
- **Custom mode `migration-surgeon`** (`.bob/custom_modes.yaml`): a Bob mode whose only job is to take a
  LockSmith report (`locksmith-report.json`) and rewrite each flagged migration into safe, ordered
  expand/contract migration files, plus the minimal application-code changes (dual-write / read switch),
  never editing unflagged files. Edit permissions restricted to `db/migrations/**` and `src/**`.
- **Parallel subagents**: one subagent per flagged migration; the parent task merges results and
  re-runs `npm run locksmith -- --dir <repo>` to verify the risk score dropped and no critical findings remain.
- **Skill `lock-audit`** (`.bob/skills/lock-audit/SKILL.md`): the checklist Bob follows (read report →
  read Postgres lock reference → rewrite → run gate → summarise before/after).

## 6. Surfaces
- **Web app** (Next.js): dashboard for the demo repo, per-migration lock timeline, finding detail with
  measured lock evidence, Bob rewrite diff, before/after gate result; a "paste your migration" analyzer.
- **CLI** `npm run locksmith -- --dir demo-repo [--json out.json]` — exit code 1 when the gate fails (CI).

## 7. Non-goals
MySQL, ORMs' DSLs (Prisma/Rails) — future work. No production DB access: LockSmith never connects to a real database.
