# IBM Bob Usage Log

Account: hackathon-provisioned enterprise plan (budget 40 Bobcoins), Bob IDE v2.2.0, Windows.
Verified in Bob Settings → General before the first task (Budget 40.00, 100% remaining, usage 0).

**How Bob was driven:** prompts were typed into the Bob IDE chat panel (Agent mode) of the project
workspace `ibm-bob-2-hackathon`. The operator (Talal, assisted by Claude Code acting on his machine)
wrote prompts, reviewed every diff Bob produced, approved/rejected command executions, and validated
results with tests. Every task's session-consumption summary is screenshotted into `bob_sessions/`.

Auto-approve settings per task: Read, Edit, Todo, Subtask, Subagent = on; Execute = **off** (each command
Bob wanted to run was reviewed before approval).

| # | Time (PKT) | Task given to Bob | Files Bob touched | Outcome / accepted? | Validation | Screenshot |
|---|---|---|---|---|---|---|
| 1 | 2026-09-27 09:20 | Read SPEC.md + demo-repo; write ARCHITECTURE.md, engine type contracts, expected-rule acceptance table | _pending_ | _pending_ | _pending_ | `bob_sessions/teqprotech_task01_architecture_summary.png` |
