# 🔒 LockSmith — catch the migration that locks production, before you ship it

**IBM Bob 2.0 Hackathon (lablab.ai) · Team Teqprotech — solo entry by Talal Khawaja · MIT licensed**

LockSmith is a deploy gate for PostgreSQL schema migrations. It **detects** statements that would block
reads or writes on large tables, **proves** the lock each statement takes by replaying the migration inside
a real embedded Postgres, **estimates** how long production would be blocked, and uses **IBM Bob** — through a
custom Bob mode and skill shipped in this repo — to **rewrite** each dangerous migration into a zero-downtime
expand → backfill → contract sequence, then **re-verifies** Bob's rewrite with the same gate.

- Live demo: **https://locksmith-ibm-bob.vercel.app**
- Demo video: MP4 (2:27) attached to the lablab.ai submission · script in [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md)
- IBM Bob task session screenshots: [`bob_sessions/`](bob_sessions/)

---

## The problem

Schema migrations go through the same pull-request review as application code, but their danger is invisible in a diff:

| Innocent-looking line | What PostgreSQL actually does |
|---|---|
| `CREATE INDEX idx ON orders (customer_id);` | `ShareLock` on `orders` for the whole index build → **all writes blocked** |
| `ALTER TABLE orders ALTER COLUMN total TYPE numeric(12,2);` | `AccessExclusiveLock` + **full table rewrite** → reads *and* writes blocked |
| `ALTER TABLE orders ADD COLUMN shipped_at timestamptz NOT NULL DEFAULT now();` | volatile default → **full table rewrite** |
| `ALTER TABLE customers RENAME COLUMN email TO email_address;` | instant — but every running app instance that still says `email` **breaks** |
| any of the above without `SET lock_timeout` | queues behind one slow query and then blocks **every** query behind it |

Reviewers have to know lock semantics by heart and do table-size arithmetic in their heads. When they miss one,
the result is an outage; when they catch one, the safe rewrite costs a senior engineer hours.

## The solution

```
db/migrations/*.sql ─► 1 Detect (12 rules) ─► 2 Prove (PGlite lock probe) ─► 3 Impact (table stats)
                                                                                  │
      CI gate ◄─ 5 Re-verify (same engine) ◄─ 4 Rewrite with IBM Bob (migration-surgeon mode, 1 subagent / migration)
```

1. **Detect** — 12 deterministic rules (LS001–LS012): non-concurrent indexes, NOT NULL adds, volatile defaults,
   type changes, `SET NOT NULL`, validated FK/CHECK constraints, renames/drops **still referenced by application code**,
   missing `lock_timeout`, `CONCURRENTLY` inside transactions, un-batched backfills.
2. **Prove** — every statement is replayed in an in-process PostgreSQL ([PGlite](https://pglite.dev)); LockSmith reads
   `pg_locks` for the lock actually taken and compares `pg_class.relfilenode` before/after to detect a table rewrite.
3. **Impact** — declared production sizes (`db/table-stats.json`) turn a lock into "~N seconds, ~M writes blocked".
4. **Rewrite (IBM Bob)** — the `🔒 Migration Surgeon` custom mode + `lock-audit` skill make Bob rewrite each flagged
   migration in its own subagent, update the dependent app code (dual-write for renames), and never touch unflagged files.
5. **Re-verify & gate** — Bob's output goes back through the same engine; the CLI exits `1` while any critical finding remains.

## Results on the demo repository

Fictional *Shopfront* app, 8 pending migrations; declared sizes: `orders` 42M rows, `order_items` 118M, `customers` 3.2M.

| | As written by the team (`demo-repo/`) | After IBM Bob rewrite (`demo-repo-safe/`) |
|---|---|---|
| Deploy gate | ❌ **FAIL** (CLI exit 1) | ✅ **PASS** (exit 0) |
| Risk score | **100** / 100 | **0** / 100 |
| Findings | 14 (4 critical, 4 high, 6 medium) | 0 |
| Longest blocking lock (est.) | ≈ 4.7 min (`ALTER … TYPE`, table rewrite) | none |
| Migration files | 8 | 15 (6 dangerous files → 13 ordered safe files) |

Examples of **measured** evidence (from `pg_locks` / `relfilenode` in PGlite):
`CREATE INDEX` → `ShareLock` on `orders` · `ALTER COLUMN total TYPE` → `AccessExclusiveLock` + table rewrite ·
FK add → `ShareRowExclusiveLock` on both tables · `ADD COLUMN tracking_code text NOT NULL` → Postgres error
*"column contains null values"*.

## How IBM Bob 2.0 was used

IBM Bob IDE 2.2 (hackathon enterprise account) is used in **two** ways. Full per-task log with accepted/rejected
changes and validation: [`docs/BOB_USAGE_LOG.md`](docs/BOB_USAGE_LOG.md); session summaries: [`bob_sessions/`](bob_sessions/).

**1. Bob is the product's rewrite engine.** `.bob/custom_modes.yaml` defines the **🔒 Migration Surgeon** mode
(edits restricted by `fileRegex` to migrations and app source — Bob itself tightened it so the mode cannot touch
LockSmith's engine), `.bob/rules-migration-surgeon/01-postgres-locks.md` is the lock reference Bob reads at rewrite
time, and `.bob/skills/lock-audit/SKILL.md` is the checklist. In task 5 Bob ran that skill on the demo repo: ran the
gate, **spawned 6 subagents in parallel (one per flagged migration)**, replaced them with 13 ordered safe files,
updated `src/customers.ts` / `src/orders.ts` for dual-writes, re-ran the gate, and withdrew its own column-drop step
after noticing the app still wrote to that column.

**2. Bob built most of LockSmith.** Six Bob IDE tasks, 13.07 of the 40 provided Bobcoins:

| Task | What Bob did | Validation |
|---|---|---|
| 1 | Read `docs/SPEC.md` + demo repo → `docs/ARCHITECTURE.md`, `src/engine/types.ts`, acceptance table | one claim rejected in review |
| 2 | Splitter, classifier, rules LS001–LS012, impact model, `analyzeRepo`, 53 tests | re-run 53/53; defect found → task 3 |
| 3 | PGlite lock probe (pg_locks, relfilenode, seeding, CONCURRENTLY) + LS002 fix | re-run 58/58, measured locks checked |
| 4 | Migration Surgeon mode, lock reference rules, lock-audit skill, guide | YAML parsed; mode loaded in Bob IDE |
| 5 | Rewrite of the release in Migration Surgeon mode with 6 parallel subagents | gate FAIL/100 → PASS |
| 6 | Fixed an engine false positive (PG12+ validated CHECK) + security review of `/api/analyze` (4 fixes) | re-run 61/61, after-repo risk 0 |

## Architecture

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) (written by Bob in task 1).

| Layer | Tech |
|---|---|
| Engine | TypeScript: `src/engine/{split,classify,rules,probe,impact,analyze}.ts` |
| Lock probe | `@electric-sql/pglite` (PostgreSQL compiled to WASM, in-process, no server) |
| CLI / CI gate | `cli/locksmith.ts` (tsx) |
| Web app | Next.js 16 (App Router), Tailwind CSS 4, deployed on Vercel |
| AI rewrite | IBM Bob IDE 2.2 — custom mode `.bob/custom_modes.yaml`, rules `.bob/rules-migration-surgeon/`, skill `.bob/skills/lock-audit/` |

## Run it

```bash
npm install
npm test                                   # engine + probe tests
npm run locksmith -- --dir demo-repo       # gate: FAIL (exit 1)
npm run locksmith -- --dir demo-repo-safe  # gate after Bob's rewrite
npm run dev                                # http://localhost:3000
```

No environment variables or external services are required. LockSmith never connects to a real database.

### Use the Bob mode on your own repo
1. Open your repository in **IBM Bob IDE** and copy this repo's `.bob/` folder into it.
2. `npx tsx <path-to-locksmith>/cli/locksmith.ts --dir . --json locksmith-report.json`
3. In Bob, pick **🔒 Migration Surgeon** and ask: *"Run the lock-audit skill on this repo."*

Details: [`docs/BOB_MODE.md`](docs/BOB_MODE.md).

## Testing

```bash
npm test          # 61 tests: rules (unit + demo-repo acceptance) and PGlite probe
npm run typecheck # tsc --noEmit
npm run lint      # eslint (0 errors)
npm run build     # Next.js production build (report pages prerendered with real probe data)
```
Verified on 2026-09-27: 61/61 tests passing, typecheck clean, lint 0 errors, build succeeds; CLI exit codes 1/0 on
`demo-repo` / `demo-repo-safe`; all pages 200 and free of horizontal scroll at 390 px; `/api/analyze` error states
(non-JSON, empty SQL, oversize) return clean messages.

## Who built what (honest attribution)

| Part | Author |
|---|---|
| `docs/ARCHITECTURE.md`, `src/engine/**` (splitter, classifier, 12 rules, probe, impact, analyze, tests), `.bob/**`, `docs/BOB_MODE.md`, `demo-repo-safe/**` rewrite, `/api/analyze` hardening | **IBM Bob** (6 IDE tasks, reviewed and validated by the team) |
| `docs/SPEC.md`, fictional `demo-repo/`, Next.js UI (`src/app/**`, `src/components/**`), CLI output formatting (`cli/locksmith.ts`), video, slides, docs | Team, with Claude Code as a coding assistant |

## Security & data

- Demo repository `demo-repo/` is **fictional** (no real company, customer or personal data).
- The `/api/analyze` endpoint runs submitted SQL only inside a throwaway in-memory PGlite instance, caps input at
  20 000 characters, and persists nothing.
- No secrets are used by the app; `.env*` is git-ignored.

## Limitations

- PostgreSQL only; SQL migration files only (no ORM DSLs yet).
- Durations are estimates from declared row counts and fixed throughput constants, not measurements of your hardware.
- `CREATE INDEX CONCURRENTLY` cannot run inside the probe's transaction; its lock is recorded as *inferred* (flagged in the UI).
- Lock waits caused by *other* sessions (lock-queue pile-ups) are modelled by rule LS010, not simulated.

## Roadmap

GitHub Action wrapper · Prisma / Rails / Flyway adapters · real `pg_stat` import for table sizes · MySQL (online DDL) rules ·
watsonx.ai-generated rollout runbooks for on-call.

## License

MIT — see [LICENSE](LICENSE).
