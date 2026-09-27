# Submission checklist — IBM Bob 2.0 Hackathon (deadline **Sun 2026-09-27 20:00 PKT / 11:00 ET**)

| Deliverable | Status | Where |
|---|---|---|
| Project title (≤50) | ✅ drafted (46 chars) | `docs/SUBMISSION_DRAFT.md` |
| Short description (50–255) | ✅ drafted | same |
| Long description ≤500 words | ✅ 417 words / 2 769 chars | same |
| IBM Bob usage statement ≤500 words | ✅ 409 words / 2 771 chars | same |
| Categories / technology tags | ✅ drafted | same |
| Public code repository | ⏳ blocked — decision on email in git history, then create `kmt9967/locksmith-ibm-bob` | — |
| `bob_sessions/` with task-summary PNGs | ✅ 6 sessions (Talal) · ⚠️ teammates see below | `bob_sessions/` |
| Code where Bob assisted in repo | ✅ `src/engine/**`, `.bob/**`, `demo-repo-safe/**`, … | `docs/BOB_USAGE_LOG.md` |
| Application URL | ⏳ blocked — Vercel CLI login needed | — |
| Demo application platform | Web (Next.js on Vercel) + CLI | — |
| Cover image | ✅ 1280×720 | `docs/submission/cover.png` |
| Video (MP4, ≤3:00, ≥90 s product, narration, shows Bob) | ✅ 2:27, 1366×768, narrated (neural TTS) | `F:\ClaudeWorkspace\output\locksmith\locksmith-demo.mp4` |
| Slide presentation | ✅ 8 slides PDF | `docs/submission/LockSmith-slides.pdf` |
| MIT-compliant / original | ✅ MIT LICENSE, original work, fictional data | `LICENSE` |
| Data rules (no PI / client / social data) | ✅ fictional schema only | `demo-repo/README.md` |

## Team requirement (from the live page)
> "Your repository must include … IBM Bob task session summary screenshots **from each team member**."

Team **Teqprotech** has 4 members. Only Talal's sessions exist so far. Each of **Aqeela Urooj, Shadab Akhund,
Umer Anis** should, before submission:
1. Accept their own IBM Bob hackathon invite email and sign in to Bob IDE with their IBMid (hackathon account
   `ibm-coding-challenge-uat` / us-east).
2. `git clone https://github.com/kmt9967/locksmith-ibm-bob` and open it in Bob IDE.
3. Run one genuine task on this project, e.g. switch to **🔒 Migration Surgeon** and ask:
   *"Run the lock-audit skill on ./demo-repo and write the result to a new folder demo-repo-<yourname>"* — or Agent mode:
   *"Review src/engine/rules.ts for missed PostgreSQL lock hazards and add one tested rule improvement."*
4. Open Tasks → select the task → click the task header → screenshot the summary →
   save as `bob_sessions/teqprotech_<name>_task01_<topic>_summary.png` and send it to Talal (or push it).
If a teammate cannot do this, the submission will contain only Talal's sessions — state that honestly.
