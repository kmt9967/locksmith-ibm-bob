# lablab.ai submission draft — LockSmith

## Project title (5–50 chars)
LockSmith: IBM Bob fixes locking DB migrations

## Short description (50–255 chars)
LockSmith catches PostgreSQL migrations that would lock production tables, proves each lock in a real embedded Postgres, and uses a custom IBM Bob mode with parallel subagents to rewrite them into verified zero-downtime rollouts.

## Long description — Problem & Solution (≤500 words)

**Problem.** Database schema migrations ship through the same pull-request review as application code, but their risk is invisible in a diff. On PostgreSQL, a one-line `CREATE INDEX` holds a ShareLock that blocks every write for the whole index build; `ALTER COLUMN … TYPE` takes an AccessExclusiveLock and rewrites the table; a column rename is instant but breaks every running app instance that still uses the old name; and any heavy DDL without `lock_timeout` can queue behind one slow query and freeze all traffic behind it. Catching this requires lock-semantics expertise and table-size arithmetic most reviewers don't carry in their heads. Misses cause outages; the safe expand → backfill → contract rewrite costs a senior engineer hours per migration.

**Solution.** LockSmith turns that review into a measured, automated gate — and hands the fix to IBM Bob.
1. **Detect:** 12 deterministic rules (LS001–LS012) over parsed SQL: non-concurrent indexes, NOT NULL adds, volatile defaults, type changes, SET NOT NULL, validated FK/CHECK constraints, renames/drops still referenced by application code, missing lock_timeout, CONCURRENTLY inside transactions, un-batched backfills.
2. **Prove:** every statement is replayed in an in-process PostgreSQL (PGlite). LockSmith reads `pg_locks` for the lock actually taken and compares `relfilenode` to detect table rewrites — evidence, not guesses.
3. **Impact:** declared production table sizes turn locks into "≈N seconds, ≈M writes blocked".
4. **Rewrite with IBM Bob:** the repo ships a custom Bob mode (Migration Surgeon), a Postgres lock reference Bob reads, and a lock-audit skill. Bob runs the gate, spawns one subagent per flagged migration in parallel, rewrites each into safe ordered files (concurrent indexes, NOT VALID + VALIDATE constraints, batched backfills, lock timeouts, dual-write app code for renames), then re-runs the gate on its own output.
5. **Gate:** the CLI exits non-zero while any critical finding remains, so CI blocks unsafe deploys.

**Target users:** backend and platform engineers, reviewers and SREs at teams running PostgreSQL. They interact through the CLI in CI, the web report (per-migration lock evidence and impact), the paste-a-migration analyzer, and Bob IDE for the rewrite.

**Result on the demo repo** (fictional e-commerce app, 8 pending migrations, orders = 42M rows): gate **FAIL, risk 100** → after Bob's rewrite **gate PASS, risk AFTER_SCORE**, with 6 dangerous migrations replaced by 13 safe, ordered files and the app code updated for dual-writes.

**What makes it different:** the AI is not trusted — it is verified. A deterministic engine with real Postgres lock measurements judges; IBM Bob does the tedious, judgement-heavy surgery, in parallel, and must pass the same gate.

## IBM Bob usage statement (≤500 words)

BOB_STATEMENT

## Technologies / tags
IBM Bob, IBM Bob IDE, TypeScript, Next.js, PostgreSQL, PGlite, Tailwind CSS, Vercel, Vitest

## Category
Developer tools · Release & deployment workflow · DevOps

## Links
- Repository: REPO_URL
- Live app: LIVE_URL
- Video: VIDEO (MP4 upload)
