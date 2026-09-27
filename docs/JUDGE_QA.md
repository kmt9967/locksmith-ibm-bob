# Judge Q&A — LockSmith

**Is the analysis real or mocked?**
Real. Findings come from 12 deterministic rules over parsed SQL. Lock evidence comes from executing each statement inside
an in-process PostgreSQL (PGlite) and reading `pg_locks` for the current backend; table rewrites are detected by comparing
`pg_class.relfilenode` before and after. Example: the demo's `tracking_code … NOT NULL` fails in Postgres itself with
"column contains null values". The `/analyze` page runs the same engine on anything you paste.

**What exactly does IBM Bob do — at build time and at run time?**
- *Run time (product):* the repo ships a Bob custom mode (`migration-surgeon`), mode-specific rules (a Postgres lock
  reference document Bob reads) and a skill (`lock-audit`). In Bob IDE a developer selects the mode and runs the skill:
  Bob runs the LockSmith gate, spawns **one subagent per flagged migration in parallel**, rewrites each into an
  expand → backfill → contract sequence, updates dependent app code, and re-runs the gate on its own output.
- *Build time:* Bob wrote the architecture and contracts, the rule engine, the PGlite probe and most tests, and fixed a
  defect we found in review. Each session's task summary screenshot is in `bob_sessions/`, and `docs/BOB_USAGE_LOG.md`
  lists what was accepted, rejected and how it was validated.

**Why not just let Bob review migrations directly?**
Because lock behaviour must be *proven*, not guessed. LockSmith's deterministic engine is the judge; Bob is the surgeon.
Bob's rewrites are only accepted when the same gate — with measured locks — passes.

**How are durations estimated?**
`rows / throughput` using constants (rewrite 150k rows/s, scan 1.5M rows/s) and declared `writesPerSec`. They are
estimates to rank risk, clearly labelled "est." in the UI; the lock *mode* is measured.

**What about `CREATE INDEX CONCURRENTLY`?**
It cannot run inside a transaction, so the probe runs it directly and records the documented `ShareUpdateExclusiveLock`
as **inferred** (labelled in the UI). Mixing it with other statements is flagged by LS011.

**Is any real company data used?**
No. `demo-repo/` is an invented e-commerce schema. No personal data, no client data, no social-media data.

**What's the business value?**
Migration-induced lock outages are a recurring cause of production incidents. LockSmith turns a senior-engineer
review ("does this lock orders? for how long?") into a CI check and turns hours of manual expand/contract rewriting into
a verified Bob task.

**What's next?**
GitHub Action, ORM adapters (Prisma/Rails/Flyway), importing real table sizes from `pg_stat_user_tables`, MySQL rules,
and optional watsonx.ai-generated rollout runbooks.
