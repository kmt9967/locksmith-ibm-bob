# Using IBM Bob to Rewrite Unsafe Migrations

LockSmith ships a Bob **mode** and a **skill** that turn IBM Bob IDE into an
autonomous migration rewrite engine. Bob reads the LockSmith report, rewrites
every flagged migration into a safe expand/contract sequence, updates
application source, and re-runs the gate to verify the fix — without touching
a single unflagged file.

---

## Prerequisites

| Requirement | Notes |
|-------------|-------|
| IBM Bob IDE | Any version that supports custom modes and skills |
| Node.js ≥ 18 | Required to run `npm run locksmith` |
| This repository open as a workspace | `.bob/` config is workspace-scoped |

The `.bob/` directory in this repo ships all required configuration; no
installation step is needed.

---

## Files shipped in this repo

```
.bob/
  custom_modes.yaml                        ← registers the migration-surgeon mode
  rules-migration-surgeon/
    01-postgres-locks.md                   ← PostgreSQL lock reference (Bob reads at rewrite time)
  skills/
    lock-audit/
      SKILL.md                             ← step-by-step audit + rewrite checklist
```

---

## Workflow: auditing and rewriting your own repository

### Step 1 — Generate the LockSmith report

Open a terminal in the LockSmith project root and run:

```bash
npm run locksmith -- --dir /path/to/your-repo --json locksmith-report.json
```

This writes `locksmith-report.json` to the current directory. The exit code is
`1` if the gate fails (any critical finding), `0` if it passes.

You can also pipe the JSON report to a file inside your own repo if you prefer:

```bash
npm run locksmith -- --dir . --json locksmith-report.json
# run from inside your own repo with LockSmith installed as a dev dependency
```

### Step 2 — Switch to Migration Surgeon mode

In Bob IDE, open the mode picker (the mode selector in the chat header) and
choose **Migration Surgeon**. The mode is listed as
`Migration Surgeon` with the description
*"Rewrites PostgreSQL migrations flagged by a LockSmith report into safe
expand → backfill → contract sequences."*

This mode restricts Bob's edit permissions to:
- `db/migrations/**/*.sql` — migration files only
- `src/**/*.ts` — application TypeScript source
- `*locksmith*.md` — report and summary markdown

Bob will refuse to edit any other file while in this mode.

### Step 3 — Run the lock-audit skill

In the Bob chat, type:

```
/lock-audit
```

Or simply describe what you want:

> "Audit the migrations in ./demo-repo and rewrite any flagged ones."

Bob will auto-activate the `lock-audit` skill and walk through the full
checklist:

1. Run `npm run locksmith -- --dir <repo> --json locksmith-report.json`
2. Parse the report and identify flagged migrations
3. Load `.bob/rules-migration-surgeon/01-postgres-locks.md` as the lock reference
4. Spawn one subagent per flagged migration (parallel execution)
5. Write the rewritten SQL files and update app source as needed
6. Re-run `npm run locksmith` to verify gate passage
7. Write `<repo>/locksmith-summary.md` with a before/after table

### Step 4 — Review the output

Bob will create new migration files with letter suffixes to preserve ordering,
for example:

```
Original:   002_orders_customer_index.sql      (LS001: CREATE INDEX without CONCURRENTLY)

Rewritten:
  002a_orders_customer_index_lock.sql           -- SET lock_timeout = '3s'; safe table DDL
  002b_orders_customer_index_conc.sql           -- locksmith:no-transaction
                                                -- CREATE INDEX CONCURRENTLY ...
```

Inspect each new file before committing. The original flagged file is not
deleted — it is superseded by the split files.

### Step 5 — Check the summary

Open `<repo>/locksmith-summary.md` for the before/after table:

```markdown
| Migration          | Risk Score Before | Risk Score After | Delta |
|--------------------|-------------------|------------------|-------|
| 002_...            | 85                | 0                | -85   |
```

The summary also lists every file created or modified and any manual steps
required (e.g. "deploy the expand phase before running the contract migration").

---

## Important: expand/contract deployments require two deploys

Some rewrites split a migration into an **expand phase** and a **contract
phase** separated by an application deployment. Bob will note this in the
summary. The sequence is:

```
1. Run expand migration  (adds new column, creates new index, etc.)
2. Deploy application    (dual-write old + new column; read from new column)
3. Verify backfill is complete
4. Run contract migration (drop old column, set NOT NULL, etc.)
5. Deploy application    (remove dual-write, reference new column only)
```

**Never run the contract migration before the expand application is deployed.**
Bob will include a warning in `locksmith-summary.md` for any migration that
requires this two-phase deployment.

---

## What Bob will never do in this mode

- Edit a migration file that has zero LockSmith findings.
- Edit files outside `db/migrations/`, `src/`, or `*locksmith*.md`.
- Combine multiple concerns in one migration file.
- Use `CREATE INDEX CONCURRENTLY` inside a transaction block.
- Issue an un-batched `UPDATE` or `DELETE` over a whole table.
- Weaken or suppress a LockSmith rule.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| Mode not listed in picker | `custom_modes.yaml` failed validation | Check for duplicate slugs, invalid group names, or regex syntax errors in `.bob/custom_modes.yaml` |
| `/lock-audit` not recognised | Skill directory name is wrong | Confirm `.bob/skills/lock-audit/SKILL.md` exists (directory must be lowercase `lock-audit`) |
| Gate still fails after rewrite | A finding requires manual app-code changes (e.g. LS008 rename) | Follow the expand/contract steps in `locksmith-summary.md` manually, then re-run `npm run locksmith` |
| `CREATE INDEX CONCURRENTLY` error in migration runner | Runner is wrapping the file in a transaction | Ensure the migration runner respects the `-- locksmith:no-transaction` comment at the top of the file and executes it outside a `BEGIN/COMMIT` block |
| Bob edits an unexpected file | Mode `fileRegex` may need adjustment | Review `.bob/custom_modes.yaml` — the regex `(db/migrations/.*\\.sql\|src/.*\\.ts\|.*locksmith.*\\.md)$` covers the expected paths |

---

## Running in CI

The LockSmith CLI exits with code `1` when the gate fails. Add this to your
pipeline to block merges that introduce unsafe migrations:

```yaml
# GitHub Actions example
- name: LockSmith gate
  run: npm run locksmith -- --dir . --json locksmith-report.json
```

If the gate fails, download the `locksmith-report.json` artifact, open the
repo in Bob IDE with Migration Surgeon mode, and run `/lock-audit` to
automatically generate the safe rewrites.
