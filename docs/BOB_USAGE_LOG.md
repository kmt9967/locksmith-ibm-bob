# IBM Bob Usage Log

Account: hackathon-provisioned enterprise plan (budget 40 Bobcoins), Bob IDE v2.2.0, Windows.
Verified in Bob Settings → General before the first task (Budget 40.00, 100% remaining, usage 0).

**How Bob was driven:** prompts were typed into the Bob IDE chat panel (Agent mode) of the project
workspace `ibm-bob-2-hackathon`. The operator (Talal, assisted by Claude Code acting on his machine)
wrote prompts, reviewed every diff Bob produced, approved/rejected command executions, and validated
results independently. Every task's session-consumption summary is screenshotted into `bob_sessions/`.

Auto-approve per task: Read, Edit, Todo, Subtask, Subagent = on; **Execute = off**. Commands Bob asked to
run were approved only if they were on an allow-list of test/typecheck commands (`npx vitest run`,
`npx tsc --noEmit`, `npm run locksmith …`); anything else required manual review.

| # | Time (PKT) | Task given to Bob | Files Bob created/changed | Accepted / rejected | Independent validation | Bobcoins | Screenshot |
|---|---|---|---|---|---|---|---|
| 1 | 09:20 | Read `docs/SPEC.md` + the demo repo (document understanding); write architecture, TypeScript contracts and an expected-rule acceptance table | `docs/ARCHITECTURE.md`, `src/engine/types.ts` | Accepted, except the acceptance-table claim that LS002 fires on `NOT NULL DEFAULT now()` (**rejected** — that statement succeeds; corrected in the Task 2 prompt) | Bob ran `tsc --noEmit` (approved); types reviewed by hand | 0.541 | `bob_sessions/teqprotech_task01_architecture_contracts_summary.png` |
| 2 | 09:35 | Implement the static engine: statement splitter (comments, strings, dollar-quotes), classifier (multi-action ALTER TABLE), rules LS001–LS012, impact model, `analyzeRepo`, and tests | `src/engine/split.ts`, `classify.ts`, `rules.ts`, `impact.ts`, `analyze.ts`, `rules.test.ts` (53 tests) | Accepted. **Defect found in review:** LS002 still fired for `shipped_at … DEFAULT now()` despite the instruction → sent back to Bob in Task 3 | Re-ran myself: `vitest` 53/53 pass, `tsc` clean, CLI on demo-repo → gate FAIL (exit 1) | 3.20 | `bob_sessions/teqprotech_task02_static_engine_rules_tests_summary.png` |
| 3 | 09:55 | Implement the PGlite lock probe (pg_locks + relfilenode rewrite detection, synthetic seeding, CONCURRENTLY handling) and fix the LS002 defect | _pending_ | _pending_ | _pending_ | _pending_ | `bob_sessions/teqprotech_task03_…` |

Code written outside Bob (by the operator with Claude Code) is listed in the README under "Who built what".
