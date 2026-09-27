---
name: lock-audit
description: >-
  Use when the user wants to audit a repository's PostgreSQL migrations for
  lock safety, rewrite flagged migrations into zero-downtime expand/contract
  sequences, and produce a before/after LockSmith summary. Activate this skill
  to run the full checklist: generate the JSON report, spawn one subagent per
  flagged migration, merge results, re-run the gate, and write
  locksmith-summary.md.
---

# Lock Audit Skill

Follow these steps in order. Do not skip steps. Do not begin a later step
until the previous one is complete and its output has been verified.

---

## Step 1 — Identify the target repository

Ask the user for the path to the repository to audit if it was not already
provided. Call it `<repo>` throughout these instructions.

If the user is working inside the LockSmith project itself and wants to audit
the bundled demo repo, use `./demo-repo` as `<repo>`.

---

## Step 2 — Run LockSmith and capture the baseline report

Execute the following command and wait for it to finish:

```
npm run locksmith -- --dir <repo> --json locksmith-report.json
```

Use `execute_command`. Record:
- Exit code (0 = gate passes, 1 = gate fails).
- The path to `locksmith-report.json` (written in the current working directory
  unless the user specifies otherwise).

Read `locksmith-report.json` with `read_file`. Parse out:
- `summary.riskScore` per migration (before values).
- `summary.gate` (before value: "pass" or "fail").
- All `findings` entries. Group them by `migration` filename.
- Total finding count per rule ID across all migrations.

If the report contains zero findings, write a one-line `locksmith-summary.md`
stating "No findings — gate: <gate>." and stop.

---

## Step 3 — Load the lock reference

Use `use_skill` is not needed here; instead read the lock reference document
directly:

```
read_file(".bob/rules-migration-surgeon/01-postgres-locks.md")
```

Keep the full content in context for all subsequent subagent prompts. This is
the authoritative reference for safe alternatives.

---

## Step 4 — Spawn one subagent per flagged migration

For each distinct migration filename that has at least one finding:

1. Read the migration file with `read_file`.
2. Collect all findings for that migration from the report.
3. Spawn a subagent using `spawn_subagent` with `fork_context: true`.

   The subagent description must contain:
   - The full text of the migration file.
   - The list of findings (ruleId, severity, line, message, safePattern) for
     that migration only.
   - The full text of `.bob/rules-migration-surgeon/01-postgres-locks.md`.
   - These instructions:
       "You are operating as migration-surgeon. Rewrite this migration into the
       minimal set of safe SQL files following the expand/contract pattern.
       Apply the safe alternative for every finding. Follow all customInstructions
       from the migration-surgeon mode exactly:
       - Never edit a migration that has no finding.
       - Preserve numbering with letter suffixes (e.g. 002a_, 002b_).
       - One concern per file.
       - CREATE INDEX CONCURRENTLY in its own file starting with
         '-- locksmith:no-transaction'.
       - Every file touching ShareLock or stronger starts with
         SET lock_timeout = '3s';
       - Data backfills are batched by PK range in their own file.
       - Renames/drops follow expand/contract with app source updated.
       Return: a list of (filename, full SQL content) pairs for every new or
       replaced file, plus a list of (filepath, diff summary) for any .ts
       source changes needed."

4. Collect the subagent's returned file list.
5. Write each new migration file using `write_file` (path under `<repo>/db/migrations/`).
6. Apply any application source changes with `apply_diff` or `search_and_replace`.

Subagents for different migrations may be spawned in parallel (one `spawn_subagent`
call per migration in the same turn) since they operate on independent files.

---

## Step 5 — Re-run the gate

After all subagent writes are complete, execute:

```
npm run locksmith -- --dir <repo> --json locksmith-report-after.json
```

Read `locksmith-report-after.json`. Record:
- `summary.gate` (after value).
- `summary.riskScore` per migration (after values).
- Remaining findings grouped by ruleId.

If the gate still fails (exit code 1) or critical findings remain:
- Identify which findings were not resolved.
- For each unresolved finding, spawn a new subagent (Step 4 pattern) and repeat
  Steps 4-5 until the gate passes or you have attempted three full iterations.
- After three iterations without gate passage, stop and report the remaining
  findings to the user with a clear explanation of why they could not be
  automatically resolved.

---

## Step 6 — Write locksmith-summary.md

Write `<repo>/locksmith-summary.md` using `write_file` with this structure:

```markdown
# LockSmith Audit Summary

**Repository:** <repo>
**Date:** <ISO date>
**Gate before:** <PASS|FAIL>  **Gate after:** <PASS|FAIL>

## Risk Score by Migration

| Migration | Risk Score Before | Risk Score After | Delta |
|-----------|-------------------|------------------|-------|
| 001_...   | 72                | 0                | -72   |
| ...       | ...               | ...              | ...   |

## Findings by Rule

| Rule | Severity | Count Before | Count After |
|------|----------|-------------|------------|
| LS001 | high/critical | N | 0 |
| ...   | ...           | N | 0 |

## Files Changed

| File | Action |
|------|--------|
| db/migrations/002a_... | created (split from 002) |
| src/orders.ts          | updated (dual-write new_col) |
| ...                    | ... |

## Notes

<any manual steps required, e.g. application deployments between expand and contract phases>
```

---

## Step 7 — Report to the user

Provide a concise inline summary:
- Gate status changed from X -> Y.
- N migrations rewritten, M files created, P app-source files updated.
- Any remaining manual steps the developer must take (e.g. "deploy the expand
  phase before running the contract migration").
- Remind the user to run the contract phase migration only after confirming
  the dual-write application version is deployed and stable.
