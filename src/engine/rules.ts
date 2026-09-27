/**
 * rules.ts — Pure rule functions LS001–LS012.
 *
 * Each rule takes:
 *   stmt       — the classified Statement
 *   migration  — the Migration it belongs to
 *   context    — RuleContext with tableStats, tablesCreatedEarlier, codeIndex
 *
 * Returns Finding | null.
 *
 * Special cases (from task description):
 *   - LS002 must NOT fire when a constant DEFAULT exists (that statement succeeds).
 *     LS002 fires only when NOT NULL has NO default or a volatile default.
 *     Volatile default is LS003.
 *   - LS010 fires once per migration that has any ShareLock-or-stronger statement
 *     without a SET lock_timeout anywhere in the migration.
 */

import type {
  Statement,
  Migration,
  TableStats,
  Finding,
  Severity,
  RuleId,
} from "./types";

// ─── Context ─────────────────────────────────────────────────────────────────

/**
 * Code index: map of identifier (lower-cased) → list of "file:line" references
 * found in the app source, via whole-word match inside SQL string literals.
 */
export type CodeIndex = Map<string, string[]>;

/**
 * Context passed to every rule function.
 */
export interface RuleContext {
  /** Production size stats for tables. */
  tableStats: TableStats;
  /**
   * Set of table names (lower-cased) that were CREATE TABLE'd in an EARLIER
   * migration of this repository (not this migration).
   */
  tablesCreatedEarlier: Set<string>;
  /**
   * Set of table names (lower-cased) that were CREATE TABLE'd in the SAME migration.
   */
  tablesCreatedInThisMigration: Set<string>;
  /** Code index built from app source. */
  codeIndex: CodeIndex;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeFinding(
  ruleId: RuleId,
  severity: Severity,
  stmt: Statement,
  migration: Migration,
  message: string,
  why: string,
  safePattern: string
): Finding {
  return {
    ruleId,
    severity,
    migration: migration.name,
    statementIndex: stmt.index,
    line: stmt.line,
    table: stmt.table,
    message,
    why,
    safePattern,
  };
}

/**
 * Returns true when the table is "existing" — i.e. either it appears in tableStats
 * (was in production before any migration ran) OR it was created in an earlier
 * migration of this repo.
 * Tables created in the SAME migration are NOT existing.
 */
function isExistingTable(table: string | null, ctx: RuleContext): boolean {
  if (!table) return false;
  const lower = table.toLowerCase();
  return lower in ctx.tableStats || ctx.tablesCreatedEarlier.has(lower);
}

function getStats(table: string | null, ctx: RuleContext) {
  if (!table) return null;
  return ctx.tableStats[table.toLowerCase()] ?? null;
}

const ROW_THRESHOLD_CRITICAL = 1_000_000;

// ─── Rules ───────────────────────────────────────────────────────────────────

/**
 * LS001 — CREATE INDEX without CONCURRENTLY on an existing table.
 * Severity: high, critical if rows > 1M.
 */
export function ls001(
  stmt: Statement,
  migration: Migration,
  ctx: RuleContext
): Finding | null {
  if (stmt.kind !== "CREATE_INDEX") return null;
  if (stmt.flags.concurrently) return null;
  if (!isExistingTable(stmt.table, ctx)) return null;
  // If the table was created in the same migration, it's safe (no rows yet).
  if (stmt.table && ctx.tablesCreatedInThisMigration.has(stmt.table.toLowerCase())) return null;

  const stats = getStats(stmt.table, ctx);
  const isCritical = stats ? stats.rows > ROW_THRESHOLD_CRITICAL : false;
  const severity: Severity = isCritical ? "critical" : "high";

  return makeFinding(
    "LS001",
    severity,
    stmt,
    migration,
    `CREATE INDEX without CONCURRENTLY on table "${stmt.table}"`,
    "Acquires a ShareLock for the entire duration of the index build, blocking writes. On large tables this can take minutes.",
    "Use CREATE INDEX CONCURRENTLY in its own non-transactional migration."
  );
}

/**
 * LS002 — ADD COLUMN … NOT NULL without a constant DEFAULT.
 * Does NOT fire when a constant DEFAULT exists (that statement succeeds).
 * Does NOT fire when the table was created in the same migration.
 * Severity: critical.
 */
export function ls002(
  stmt: Statement,
  migration: Migration,
  ctx: RuleContext
): Finding | null {
  if (stmt.kind !== "ADD_COLUMN") return null;

  // Detect NOT NULL from the SQL
  const hasNotNull = /\bNOT\s+NULL\b/i.test(stmt.sql);
  if (!hasNotNull) return null;

  // If there is a constant DEFAULT, the statement succeeds — no finding.
  if (stmt.flags.constantDefault) return null;

  // If table was created in this migration, it's empty — safe.
  if (stmt.table && ctx.tablesCreatedInThisMigration.has(stmt.table.toLowerCase())) return null;

  return makeFinding(
    "LS002",
    "critical",
    stmt,
    migration,
    `ADD COLUMN "${stmt.columns[0] ?? ""}" NOT NULL without a constant DEFAULT on table "${stmt.table}"`,
    "PostgreSQL must verify every existing row satisfies NOT NULL. Without a constant DEFAULT, the statement fails on any non-empty table.",
    "Add the column as nullable first, backfill in batches, then add NOT NULL via ADD CONSTRAINT … CHECK NOT VALID + VALIDATE CONSTRAINT."
  );
}

/**
 * LS003 — ADD COLUMN … DEFAULT <volatile> forces a table rewrite.
 * Severity: high.
 */
export function ls003(
  stmt: Statement,
  migration: Migration,
  ctx: RuleContext
): Finding | null {
  if (stmt.kind !== "ADD_COLUMN") return null;
  if (!stmt.flags.volatileDefault) return null;

  // If table was created in this migration, it's empty — no rows to rewrite.
  if (stmt.table && ctx.tablesCreatedInThisMigration.has(stmt.table.toLowerCase())) return null;

  return makeFinding(
    "LS003",
    "high",
    stmt,
    migration,
    `ADD COLUMN "${stmt.columns[0] ?? ""}" with volatile DEFAULT on table "${stmt.table}"`,
    "A volatile DEFAULT (e.g. now(), gen_random_uuid()) forces PostgreSQL to rewrite the entire table to materialise the per-row default value, holding ACCESS EXCLUSIVE for the duration.",
    "Add the column without a DEFAULT, then SET DEFAULT, then batch-backfill existing rows outside the migration."
  );
}

/**
 * LS004 — ALTER COLUMN … TYPE forces rewrite + ACCESS EXCLUSIVE.
 * Severity: critical if rows > 1M, else high.
 */
export function ls004(
  stmt: Statement,
  migration: Migration,
  ctx: RuleContext
): Finding | null {
  if (stmt.kind !== "ALTER_TYPE") return null;

  const stats = getStats(stmt.table, ctx);
  const isCritical = stats ? stats.rows > ROW_THRESHOLD_CRITICAL : false;
  const severity: Severity = isCritical ? "critical" : "high";

  return makeFinding(
    "LS004",
    severity,
    stmt,
    migration,
    `ALTER COLUMN "${stmt.columns[0] ?? ""}" TYPE on table "${stmt.table}"`,
    "A column type change forces a full table rewrite under ACCESS EXCLUSIVE lock, blocking all reads and writes for the duration.",
    "Add a new column with the target type, dual-write to both columns, backfill, then swap in a separate migration."
  );
}

/**
 * LS005 — ALTER COLUMN … SET NOT NULL on existing column (full scan under ACCESS EXCLUSIVE).
 * Severity: high.
 */
export function ls005(
  stmt: Statement,
  migration: Migration,
  ctx: RuleContext
): Finding | null {
  if (stmt.kind !== "SET_NOT_NULL") return null;

  return makeFinding(
    "LS005",
    "high",
    stmt,
    migration,
    `ALTER COLUMN "${stmt.columns[0] ?? ""}" SET NOT NULL on table "${stmt.table}"`,
    "PostgreSQL performs a full table scan under ACCESS EXCLUSIVE lock to verify no NULLs remain, blocking all reads and writes.",
    "Use: ADD CONSTRAINT … CHECK (col IS NOT NULL) NOT VALID; VALIDATE CONSTRAINT; then SET NOT NULL; DROP CONSTRAINT."
  );
}

/**
 * LS006 — ADD CONSTRAINT … FOREIGN KEY without NOT VALID.
 * Severity: high.
 */
export function ls006(
  stmt: Statement,
  migration: Migration,
  ctx: RuleContext
): Finding | null {
  if (stmt.kind !== "ADD_CONSTRAINT") return null;
  if (!/\bFOREIGN\s+KEY\b/i.test(stmt.sql)) return null;
  if (stmt.flags.notValid) return null;

  return makeFinding(
    "LS006",
    "high",
    stmt,
    migration,
    `ADD CONSTRAINT FOREIGN KEY without NOT VALID on table "${stmt.table}"`,
    "Validating all existing rows under ShareRowExclusiveLock blocks writes to both the referencing and referenced tables for the duration of a full scan.",
    "Use NOT VALID to skip existing row validation, then VALIDATE CONSTRAINT in a separate migration."
  );
}

/**
 * LS007 — ADD CONSTRAINT … CHECK without NOT VALID.
 * Severity: medium.
 */
export function ls007(
  stmt: Statement,
  migration: Migration,
  ctx: RuleContext
): Finding | null {
  if (stmt.kind !== "ADD_CONSTRAINT") return null;
  if (!/\bCHECK\b/i.test(stmt.sql)) return null;
  if (stmt.flags.notValid) return null;

  return makeFinding(
    "LS007",
    "medium",
    stmt,
    migration,
    `ADD CONSTRAINT CHECK without NOT VALID on table "${stmt.table}"`,
    "Validates all existing rows under ACCESS EXCLUSIVE lock, blocking all reads and writes.",
    "Use NOT VALID to defer validation, then VALIDATE CONSTRAINT in a separate migration."
  );
}

/**
 * LS008 — RENAME COLUMN / RENAME TABLE while app code still references the old name.
 * Severity: critical.
 */
export function ls008(
  stmt: Statement,
  migration: Migration,
  ctx: RuleContext
): Finding | null {
  if (stmt.kind !== "RENAME_COLUMN" && stmt.kind !== "RENAME_TABLE") return null;

  // For RENAME_COLUMN: columns[0] = old name, columns[1] = new name.
  // For RENAME_TABLE: stmt.table = old table name (columns holds the new name if any).
  const oldName =
    stmt.kind === "RENAME_COLUMN" ? stmt.columns[0] : stmt.table ?? undefined;
  if (!oldName) return null;

  const refs = ctx.codeIndex.get(oldName.toLowerCase());
  if (!refs || refs.length === 0) return null;

  const kind = stmt.kind === "RENAME_COLUMN" ? "column" : "table";
  return makeFinding(
    "LS008",
    "critical",
    stmt,
    migration,
    `RENAME ${kind} "${oldName}" while application code still references it (${refs.length} reference(s))`,
    `Application code references "${oldName}" in ${refs.slice(0, 3).join(", ")}${refs.length > 3 ? " …" : ""}. After renaming, these queries will fail.`,
    "Expand/contract: add a new column/alias, update all code to use the new name, deploy, then drop the old column in a later migration."
  );
}

/**
 * LS009 — DROP COLUMN / DROP TABLE while app code still references it.
 * Severity: critical.
 */
export function ls009(
  stmt: Statement,
  migration: Migration,
  ctx: RuleContext
): Finding | null {
  if (stmt.kind !== "DROP_COLUMN" && stmt.kind !== "DROP_TABLE") return null;

  // Check table name for DROP TABLE, column name for DROP COLUMN
  const identifier = stmt.kind === "DROP_TABLE"
    ? stmt.table
    : stmt.columns[0];

  if (!identifier) return null;

  const refs = ctx.codeIndex.get(identifier.toLowerCase());
  if (!refs || refs.length === 0) return null;

  const kind = stmt.kind === "DROP_TABLE" ? "table" : "column";
  return makeFinding(
    "LS009",
    "critical",
    stmt,
    migration,
    `DROP ${kind} "${identifier}" while application code still references it (${refs.length} reference(s))`,
    `Application code references "${identifier}" in ${refs.slice(0, 3).join(", ")}${refs.length > 3 ? " …" : ""}. After dropping, these queries will fail.`,
    "Remove all code references first, deploy that change, then drop the column/table in a subsequent migration."
  );
}

// Lock modes that are ShareLock or stronger (block writes)
const SHARE_OR_STRONGER_KINDS = new Set<string>([
  "CREATE_INDEX", // ShareLock (without CONCURRENTLY); CONCURRENTLY = ShareUpdateExclusiveLock (weaker)
  "ADD_COLUMN",   // ACCESS EXCLUSIVE
  "DROP_COLUMN",  // ACCESS EXCLUSIVE
  "ALTER_TYPE",   // ACCESS EXCLUSIVE
  "SET_NOT_NULL", // ACCESS EXCLUSIVE
  "RENAME_COLUMN",// ACCESS EXCLUSIVE
  "RENAME_TABLE", // ACCESS EXCLUSIVE
  "ADD_CONSTRAINT",// ACCESS EXCLUSIVE (for FK / CHECK)
  "DROP_CONSTRAINT",// ACCESS EXCLUSIVE
  "DROP_TABLE",   // ACCESS EXCLUSIVE
  // CREATE_TABLE excluded: new table has no contention
]);

/**
 * Returns true if the statement kind acquires ShareLock or stronger.
 * CREATE INDEX CONCURRENTLY uses ShareUpdateExclusiveLock (weaker than ShareLock) — excluded.
 */
function acquiresShareOrStronger(stmt: Statement): boolean {
  if (!SHARE_OR_STRONGER_KINDS.has(stmt.kind)) return false;
  // CREATE INDEX CONCURRENTLY takes only ShareUpdateExclusiveLock, not ShareLock
  if (stmt.kind === "CREATE_INDEX" && stmt.flags.concurrently) return false;
  return true;
}

/**
 * LS010 — Migration has ACCESS EXCLUSIVE / ShareLock statements but no SET lock_timeout.
 * Fires once per migration (not per statement).
 * This function is called once per statement but only the FIRST qualifying call
 * in the migration produces a finding. The caller (analyze.ts) deduplicates.
 */
export function ls010(
  stmt: Statement,
  migration: Migration,
  ctx: RuleContext
): Finding | null {
  if (!acquiresShareOrStronger(stmt)) return null;

  // Check if the migration SQL has SET lock_timeout anywhere
  const hasLockTimeout = /\bSET\s+lock_timeout\b/i.test(migration.sql);
  if (hasLockTimeout) return null;

  return makeFinding(
    "LS010",
    "medium",
    stmt,
    migration,
    `Migration acquires a heavy lock but has no SET lock_timeout`,
    "Without lock_timeout, a long-running query ahead of your DDL will block it, and then every subsequent query queues behind it (lock queue pile-up), causing an outage.",
    "Add `SET lock_timeout = '3s';` at the top of the migration and implement application-level retry logic."
  );
}

/**
 * LS011 — CREATE INDEX CONCURRENTLY mixed with other statements / inside a transaction.
 * Severity: high (migration will fail).
 */
export function ls011(
  stmt: Statement,
  migration: Migration,
  ctx: RuleContext
): Finding | null {
  if (stmt.kind !== "CREATE_INDEX") return null;
  if (!stmt.flags.concurrently) return null;

  // Check if migration has more than one statement
  const hasMultiple = migration.statements.length > 1;
  // Check if migration has BEGIN / START TRANSACTION
  const hasTransaction = /\b(?:BEGIN|START\s+TRANSACTION)\b/i.test(migration.sql);

  if (!hasMultiple && !hasTransaction) return null;

  return makeFinding(
    "LS011",
    "high",
    stmt,
    migration,
    `CREATE INDEX CONCURRENTLY mixed with other statements or inside a transaction`,
    "CREATE INDEX CONCURRENTLY cannot run inside a transaction block and must be the only statement in its migration. Mixing it with other statements will cause the migration to fail.",
    "Isolate CREATE INDEX CONCURRENTLY into its own migration file without BEGIN/COMMIT."
  );
}

/**
 * LS012 — Un-batched UPDATE/DELETE of a whole table (no WHERE or WHERE without key range).
 * Severity: high.
 *
 * We fire when:
 *   - No WHERE clause at all, or
 *   - WHERE clause is present but looks like a non-selective condition
 *     (no column comparison against a scalar or range — e.g. "WHERE status IS NULL"
 *     touches all matching rows, which can be the whole table).
 *
 * The heuristic: fire when hasWhere is false, or when the WHERE does not contain
 * an id/pk range pattern (e.g. "id BETWEEN" or "id >" or "id <=").
 */
export function ls012(
  stmt: Statement,
  migration: Migration,
  ctx: RuleContext
): Finding | null {
  if (stmt.kind !== "UPDATE" && stmt.kind !== "DELETE") return null;
  if (!isExistingTable(stmt.table, ctx)) return null;

  const hasKeyRange = hasKeyRangeWhere(stmt.sql);
  if (hasKeyRange) return null;

  return makeFinding(
    "LS012",
    "high",
    stmt,
    migration,
    `Un-batched ${stmt.kind} on table "${stmt.table}" without a key-range predicate`,
    "A single-transaction UPDATE/DELETE over millions of rows holds RowExclusiveLock for the entire scan duration, accumulating a huge undo log and blocking concurrent writes.",
    "Use a batched backfill job: `WHERE id BETWEEN :start AND :end`, processing chunks outside the schema migration."
  );
}

/**
 * Returns true when the SQL has a WHERE clause that contains an id range predicate.
 * Pattern: WHERE ... <col> [ > | >= | < | <= | = | BETWEEN ] <value>
 * We look for patterns like: col > $N, col BETWEEN x AND y, col = $N on an
 * identifier that looks like a PK (id, *_id, pk, *_pk, etc.)
 */
function hasKeyRangeWhere(sql: string): boolean {
  if (!/\bWHERE\b/i.test(sql)) return false;

  // Extract the WHERE clause (after WHERE keyword)
  const whereMatch = sql.match(/\bWHERE\b([\s\S]*)/i);
  if (!whereMatch) return false;
  const whereClause = whereMatch[1];

  // Look for a key-range pattern: identifier matching typical PK pattern followed by comparison
  // Patterns: id > X, id >= X, id < X, id <= X, id = $N, id BETWEEN X AND Y
  const keyRangePattern = /\b(?:\w+_)?id\b\s*(?:>|>=|<|<=|=|\bBETWEEN\b)/i;
  return keyRangePattern.test(whereClause);
}

// ─── Exports ─────────────────────────────────────────────────────────────────

export type RuleFunction = (
  stmt: Statement,
  migration: Migration,
  ctx: RuleContext
) => Finding | null;

export const ALL_RULES: RuleFunction[] = [
  ls001,
  ls002,
  ls003,
  ls004,
  ls005,
  ls006,
  ls007,
  ls008,
  ls009,
  ls010,
  ls011,
  ls012,
];

/**
 * Run all rules against a statement and return all findings.
 * LS010 deduplication is handled in analyze.ts.
 */
export function runRules(
  stmt: Statement,
  migration: Migration,
  ctx: RuleContext
): Finding[] {
  return ALL_RULES.flatMap((rule) => {
    const f = rule(stmt, migration, ctx);
    return f ? [f] : [];
  });
}
