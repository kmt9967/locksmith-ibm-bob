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

**Result on the demo repo** (fictional e-commerce app, 8 pending migrations, orders = 42M rows): gate **FAIL, risk 100** → after Bob's rewrite **gate PASS, risk 0**, with 6 dangerous migrations replaced by 13 safe, ordered files and the app code updated for dual-writes.

**What makes it different:** the AI is not trusted — it is verified. A deterministic engine with real Postgres lock measurements judges; IBM Bob does the tedious, judgement-heavy surgery, in parallel, and must pass the same gate.

## IBM Bob usage statement (≤500 words)

IBM Bob IDE 2.2 (hackathon enterprise account) is a core component of LockSmith in two ways, and every session is evidenced by a task-summary screenshot in the repo's bob_sessions/ folder and logged in docs/BOB_USAGE_LOG.md.

1) Bob is the product's rewrite engine. The repo ships a Bob custom mode, "Migration Surgeon" (.bob/custom_modes.yaml), whose edit permissions are restricted by fileRegex to migration files and app source; mode rules (.bob/rules-migration-surgeon/01-postgres-locks.md), a PostgreSQL lock reference Bob reads while rewriting; and a skill (.bob/skills/lock-audit/SKILL.md). A developer selects the mode and runs the skill: Bob runs the LockSmith gate, spawns one subagent per flagged migration in parallel, rewrites each into an expand -> backfill -> contract sequence (CREATE INDEX CONCURRENTLY in its own no-transaction file, NOT VALID + VALIDATE constraints, batched primary-key backfills, lock_timeout, dual-write app code for renames), merges the results and re-runs the gate on its own output. On our demo repo Bob spawned 6 parallel subagents, replaced 6 dangerous migrations with 13 ordered safe files, updated two TypeScript files for dual-writes, and withdrew its own column-drop step when it noticed the app still wrote to that column. Gate: FAIL (risk 100, 14 findings) -> PASS (risk 0, 0 findings).

2) Bob built most of LockSmith, across six Bob IDE tasks using 13.07 of our 40 Bobcoins:
- Task 1 (Agent mode, document understanding): read our spec and the demo repo; wrote docs/ARCHITECTURE.md, the TypeScript contracts and an acceptance table (we rejected one incorrect claim).
- Task 2: SQL statement splitter, multi-action ALTER TABLE classifier, rules LS001-LS012, impact model, analyzeRepo and 53 tests; it iterated on vitest until green.
- Task 3: the empirical lock probe in embedded PostgreSQL (PGlite): pg_locks per statement, table-rewrite detection via relfilenode, synthetic seeding, CONCURRENTLY handling; plus a fix for a rule defect we found in review.
- Task 4: authored the Migration Surgeon mode, rules and skill, then self-tested and tightened its own fileRegex so the mode cannot edit LockSmith's engine.
- Task 5: the parallel-subagent rewrite described above.
- Task 6 (debugging + review): fixed an engine false positive exposed by task 5 (PostgreSQL 12+ validated-CHECK pattern for SET NOT NULL) with regression tests, and security-reviewed our public /api/analyze endpoint, fixing four issues (body size cap, unbounded stats loop, array guard, internal error leakage).

Every Bob change was reviewed and independently validated (tests re-run: 61/61 passing, typecheck clean). Bob's command executions were approved individually or through a strict allow-list. watsonx.ai / watsonx Orchestrate were not used.

## Technologies / tags
IBM Bob, IBM Bob IDE, TypeScript, Next.js, PostgreSQL, PGlite, Tailwind CSS, Vercel, Vitest

## Category
Developer tools · Release & deployment workflow · DevOps

## Links
- Repository: https://github.com/kmt9967/locksmith-ibm-bob
- Live app: https://locksmith-ibm-bob.vercel.app
- Video: VIDEO (MP4 upload)
