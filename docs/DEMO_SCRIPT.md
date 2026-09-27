# Demo video script — LockSmith (max 3:00)

Rules from the live page: MP4, **≤ 3:00**, **≥ 90 s showing the solution working**, narration, clearly show how IBM Bob was used.
Target runtime: **2:50**. Product-on-screen time: ~2:05.

| Time | Screen | Narration |
|---|---|---|
| 0:00–0:15 | Landing page (`/`) | "This one-line CREATE INDEX looks harmless in code review. On a 42-million-row orders table it blocks every write for about half a minute. LockSmith catches migrations like this before they ship — and uses IBM Bob to fix them." |
| 0:15–0:30 | Terminal: `npm run locksmith -- --dir demo-repo` | "Here's the team's real pending release: eight migrations. The LockSmith gate fails — risk 100 out of 100 — and CI blocks the deploy." |
| 0:30–1:05 | `/report` → expand 002, 005, 004 | "Every finding is backed by evidence. LockSmith replays each migration inside an embedded Postgres and reads pg_locks. The index build takes a ShareLock — writes blocked. The type change takes an AccessExclusiveLock and rewrites the whole table, which LockSmith detects from the relfilenode. And this rename is instant — but three queries in the app still use the old column name." |
| 1:05–1:50 | Bob IDE recording (sped up) | "The fix is done by IBM Bob. We ship a custom Bob mode — Migration Surgeon — and a lock-audit skill in the repo's .bob folder. Bob runs the gate, then spawns one subagent per dangerous migration in parallel. Each rewrites its migration into an expand, backfill, contract sequence: concurrent index builds, NOT VALID constraints, batched backfills, lock timeouts, and dual-write application code for the rename. Then Bob re-runs the gate on its own work." |
| 1:50–2:20 | `/report` → toggle "After IBM Bob rewrite" | "After Bob's rewrite: gate passes, risk drops from 100 to N, and no statement blocks writes on a large table. Same engine, same measured locks — Bob's output is verified, not trusted." |
| 2:20–2:35 | `/analyze` with the example | "You can paste any migration and get the same measured analysis in seconds." |
| 2:35–2:50 | `/bob` page (task list + screenshots) | "Bob also built most of LockSmith itself — architecture, rule engine, the Postgres lock probe and its tests — across the task sessions shown here. LockSmith: catch the migration that locks production, before you ship it." |

## Recording notes
- Record at 1366×768 or 1920×1080, browser zoom 100 %, no bookmarks bar, no personal tabs.
- Use the deployed URL; `/report` is statically generated so it loads instantly.
- Bob IDE footage: `docs/evidence/video/bob-task05.mp4` (real screen capture of Bob task 5, sped up ×4–8).
- Replace **N** with the verified after-score from `demo-repo-safe/locksmith-summary.md`.
