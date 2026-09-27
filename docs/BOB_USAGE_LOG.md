# IBM Bob Usage Log

Account: hackathon-provisioned enterprise plan (budget 40 Bobcoins), Bob IDE v2.2.0, Windows.
Verified in Bob Settings → General before the first task (Budget 40.00, 100 % remaining, usage 0) and after task 6
(usage **13.07**, 67 % remaining). The six task summaries below add up to 12.58; the difference is one prompt that was
accidentally sent as a follow-up inside task 1, stopped after a few seconds, and re-sent as task 2.

**How Bob was driven:** prompts were typed into the Bob IDE chat panel of the workspace `ibm-bob-2-hackathon`
(Agent mode for tasks 1–4 and 6; the project's own custom **Migration Surgeon** mode for task 5). The operator
(Talal, assisted by Claude Code acting on his machine) wrote prompts, reviewed every diff Bob produced,
approved or rejected command executions, and validated results independently. Each task's session-consumption
summary is screenshotted into `bob_sessions/`.

Auto-approve per task: Read, Edit, Todo, Subtask, Subagent (+ Skill in task 5) = on; **Execute = off**. Commands Bob
asked to run were approved only when they matched a strict allow-list (tests, typecheck, the LockSmith CLI,
read-only listings, and — in task 5 only — deleting a single named migration inside the `demo-repo-safe` working copy);
every other command (e.g. Bob's `node -e` YAML/regex self-tests in task 4) was read and approved by hand.

| # | Time (PKT) | Task given to Bob | Files Bob created/changed | Accepted / rejected | Independent validation | Bobcoins | Screenshot |
|---|---|---|---|---|---|---|---|
| 1 | 09:20 | Read `docs/SPEC.md` + the demo repo (document understanding); write architecture, TypeScript contracts, expected-rule acceptance table | `docs/ARCHITECTURE.md`, `src/engine/types.ts` | Accepted, except the claim that LS002 fires on `NOT NULL DEFAULT now()` — **rejected** (that statement succeeds) | Bob ran `tsc`; types reviewed by hand | 0.541 | `teqprotech_task01_architecture_contracts_summary.png` |
| 2 | 09:35 | Static engine: splitter, classifier, rules LS001–LS012, impact model, `analyzeRepo`, tests | `split.ts`, `classify.ts`, `rules.ts`, `impact.ts`, `analyze.ts`, `rules.test.ts` | Accepted; **defect found in review** (LS002 still over-fired) → sent back in task 3 | Re-ran: 53/53 tests, `tsc` clean, CLI gate FAIL on demo-repo | 3.20 | `teqprotech_task02_static_engine_rules_tests_summary.png` |
| 3 | 09:55 | PGlite lock probe (pg_locks, relfilenode rewrite detection, seeding, CONCURRENTLY) + LS002 fix | `probe.ts`, `probe.test.ts`, `analyze.ts`, `rules.ts`, `rules.test.ts` | Accepted | Re-ran: 58/58 tests, `tsc` clean; measured `CREATE INDEX → ShareLock`, `ALTER TYPE → AccessExclusiveLock + rewrite`, real Postgres error for NOT NULL without default | 2.94 | `teqprotech_task03_pglite_lock_probe_ls002_fix_summary.png` |
| 4 | 10:20 | Custom mode `migration-surgeon`, lock reference rules, `lock-audit` skill, guide | `.bob/custom_modes.yaml`, `.bob/rules-migration-surgeon/01-postgres-locks.md`, `.bob/skills/lock-audit/SKILL.md`, `docs/BOB_MODE.md` | Accepted. Bob self-tested and **tightened** its own `fileRegex` so the mode cannot edit `src/engine/` | YAML parsed independently; mode appeared in Bob's mode picker | 1.10 | `teqprotech_task04_custom_mode_skill_summary.png` |
| 5 | 10:35 | *Migration Surgeon mode:* run the lock-audit skill on `demo-repo-safe`; one subagent per flagged migration in parallel | 6 flagged migrations replaced by 13 ordered files; `src/customers.ts`, `src/orders.ts` (dual-write); `locksmith-summary.md` | Accepted. Bob withdrew its own `005c` column-drop after spotting the app still wrote to the column | Gate: FAIL/100 → PASS/40; `demo-repo/` verified untouched; screen recording of the run kept for the video | 2.21 | `teqprotech_task05_migration_surgeon_parallel_subagents_summary.png` |
| 6 | 10:55 | Debug the LS005 false positive exposed by task 5; security-review `/api/analyze` | `rules.ts`, `rules.test.ts`, `api/analyze/route.ts` | Accepted (4 API hardening fixes) | Re-ran: 61/61 tests, `tsc` clean; after-repo risk 0 / 0 findings; original still FAIL/100 | 2.59 | `teqprotech_task06_debug_false_positive_security_review_summary.png` |

Additional evidence: `docs/evidence/bob/05b-bob-parallel-subagents-running.png` (subagents running in parallel),
`docs/evidence/video/bob-task05.mp4` (screen capture of task 5).

## What was *not* written by Bob
The Next.js UI (`src/app/**`, `src/components/**`), CLI (`cli/locksmith.ts`), demo repository contents, `docs/SPEC.md`,
and submission docs were written by the operator with Claude Code. The Bob driver scripts used to type prompts and
capture screenshots live outside the repo.
