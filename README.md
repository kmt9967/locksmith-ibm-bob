# 🔒 LockSmith — catch the migration that locks production, before you ship it

**IBM Bob 2.0 Hackathon (lablab.ai) · Team Teqprotech · MIT licensed**

LockSmith is a deploy gate for PostgreSQL schema migrations. It **detects** statements that would block
reads or writes on large tables, **proves** the lock each statement takes by replaying the migration inside
a real embedded Postgres, **estimates** how long production would be blocked, and uses **IBM Bob** — through a
custom Bob mode and skill shipped in this repo — to **rewrite** each dangerous migration into a zero-downtime
expand → backfill → contract sequence, then **re-verifies** Bob's rewrite with the same gate.

- Live demo: **LIVE_URL**
- Demo video: **VIDEO_URL**
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

RESULTS_TABLE

## How IBM Bob 2.0 was used

BOB_SECTION

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

TESTING_SECTION

## Who built what (honest attribution)

WHO_SECTION

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
