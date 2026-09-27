# Project Selection

Decided 2026-09-27 ~09:05 PKT against the live rules (see HACKATHON_RULES_AUDIT.md).
Constraints: ~11 h left, 40 Bobcoins, Bob IDE must be a *core component*, judged on
Application of Technology · Presentation · Business Value · Originality.

## Landscape
~150 projects are already submitted. Heavily covered: repo onboarding, tech-debt / modernization
dashboards (RepoWatch, ORDO AI, Upkeep, RepoRevive, Vigil), code-review bots, security auditors,
test healing, dependency upgrades, CI triage, docs↔code drift, release checklists.
No observed entry targets **database schema-migration safety**.

## Candidates

| Criterion (1–5) | A. RepoGuardian (repo risk + modernization plan) | B. Flaky-test quarantine | **C. LockSmith — zero-downtime migration gate** |
|---|---|---|---|
| Fits challenge (release/deploy workflow) | 4 | 4 | **5** |
| Originality vs. submitted field | 1 (≥6 near-duplicates) | 3 | **5** |
| Business value | 4 | 3 | **5** (migration locks are a classic cause of production outages) |
| Bob as *core component* (modes, subagents, doc understanding) | 3 | 3 | **5** (custom Bob mode rewrites each flagged migration in a parallel subagent) |
| Provable, non-fake results | 3 (heuristic scores) | 2 (hard to reproduce flakiness live) | **5** (real Postgres lock probe via PGlite, deterministic rules) |
| Feasible in ~10 h, free infra | 3 | 3 | **4** |
| Demo clarity (3 min) | 3 | 2 | **5** ("this line locks `orders` for 4 min" → Bob rewrite → re-verify: 0 blocking locks) |
| **Total** | 21 | 20 | **34** |

## Decision: **LockSmith**
*Catch the migration that locks production — before you ship it.*

Workflow improved: **release & deployment of database schema changes.**
Today, a reviewer must know Postgres lock semantics by heart to spot that `ADD COLUMN … NOT NULL DEFAULT now()`
or `CREATE INDEX` without `CONCURRENTLY` will block writes on a 40M-row table. Misses cause outages; manual
expand/contract rewrites take hours of senior-engineer time.

LockSmith:
1. **Detects** risky DDL in migration files (deterministic rule engine, 10+ rules).
2. **Proves** the lock each statement takes by executing it inside a real embedded Postgres (PGlite) and reading `pg_locks`.
3. **Estimates impact** using declared production table sizes.
4. **Cross-references application code** that still reads a column being renamed/dropped.
5. **Rewrites** each risky migration into a safe expand → backfill → contract sequence using a **custom IBM Bob mode (`migration-surgeon`)**, one Bob subagent per migration in parallel.
6. **Re-verifies** Bob's rewrite with the same engine + lock probe (before/after risk score) and gates CI via a CLI.

RepoGuardian was rejected because the field already contains 6+ near-identical entries.
