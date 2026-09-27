// ─── Primitives ──────────────────────────────────────────────────────────────

export type Severity = "critical" | "high" | "medium" | "low";

export type RuleId =
  | "LS001"
  | "LS002"
  | "LS003"
  | "LS004"
  | "LS005"
  | "LS006"
  | "LS007"
  | "LS008"
  | "LS009"
  | "LS010"
  | "LS011"
  | "LS012";

// ─── Statement ───────────────────────────────────────────────────────────────

/**
 * Broad category of a DDL/DML statement, as produced by classify.ts.
 * Values match the SPEC section 3 vocabulary.
 */
export type StatementKind =
  | "ADD_COLUMN"
  | "DROP_COLUMN"
  | "ALTER_TYPE"
  | "SET_NOT_NULL"
  | "DROP_NOT_NULL"
  | "RENAME_COLUMN"
  | "RENAME_TABLE"
  | "CREATE_INDEX"
  | "DROP_INDEX"
  | "ADD_CONSTRAINT"
  | "DROP_CONSTRAINT"
  | "CREATE_TABLE"
  | "DROP_TABLE"
  | "UPDATE"
  | "DELETE"
  | "OTHER";

/** Optional flags extracted by classify.ts. */
export interface StatementFlags {
  /** Statement uses CONCURRENTLY (CREATE/DROP INDEX CONCURRENTLY). */
  concurrently?: boolean;
  /** Constraint was declared NOT VALID. */
  notValid?: boolean;
  /** DML statement carries a WHERE clause. */
  hasWhere?: boolean;
  /** ADD COLUMN DEFAULT uses a volatile function (now(), random(), gen_random_uuid(), …). */
  volatileDefault?: boolean;
  /** ADD COLUMN has a non-volatile, constant DEFAULT expression. */
  constantDefault?: boolean;
}

/**
 * A single SQL statement extracted from a migration file.
 * Produced by split.ts + classify.ts.
 */
export interface Statement {
  /** 1-based line number of the first token of this statement in the migration file. */
  line: number;
  /** 0-based index of this statement within its migration. */
  index: number;
  /** Broad semantic category. */
  kind: StatementKind;
  /** Target table name (lower-cased), if determinable. */
  table: string | null;
  /** Column names affected (lower-cased), if determinable. */
  columns: string[];
  /** Exact SQL text of this statement (trimmed, no trailing semicolon). */
  sql: string;
  /** Behavioural flags extracted during classification. */
  flags: StatementFlags;
}

// ─── Migration ───────────────────────────────────────────────────────────────

/**
 * One migration file and its parsed contents.
 */
export interface Migration {
  /** Absolute or repo-relative path to the .sql file. */
  filePath: string;
  /** Filename without directory (e.g. "002_orders_customer_index.sql"). */
  name: string;
  /** Raw SQL content of the file. */
  sql: string;
  /** Statements in parse order. */
  statements: Statement[];
}

// ─── Table stats ─────────────────────────────────────────────────────────────

/** Production size for one table, sourced from db/table-stats.json. */
export interface TableStat {
  rows: number;
  writesPerSec: number;
}

/**
 * Map of lower-cased table name → production size.
 * Keyed exactly as in db/table-stats.json.
 */
export type TableStats = Record<string, TableStat>;

// ─── Lock evidence (probe.ts output) ─────────────────────────────────────────

/**
 * Strongest PostgreSQL lock mode actually acquired by one statement, by relation.
 * Key = relation name (table or index); value = lock mode string from pg_locks.
 *
 * Examples of lock mode strings:
 *   "AccessShareLock" | "RowShareLock" | "RowExclusiveLock"
 *   | "ShareUpdateExclusiveLock" | "ShareLock" | "ShareRowExclusiveLock"
 *   | "ExclusiveLock" | "AccessExclusiveLock"
 */
export type LocksByRelation = Record<string, string>;

/**
 * Empirical lock evidence collected by probe.ts for one Statement.
 */
export interface LockEvidence {
  /** Strongest lock mode actually acquired per relation. */
  locks: LocksByRelation;
  /**
   * True when pg_class.relfilenode for the target table changed after the
   * statement executed, indicating a full table rewrite.
   */
  rewrite: boolean;
  /**
   * Error message when the statement failed inside PGlite (e.g.
   * CREATE INDEX CONCURRENTLY inside a transaction block).
   */
  error: string | null;
}

// ─── Impact ──────────────────────────────────────────────────────────────────

export type DurationClass = "rewrite" | "scan" | "instant";

/**
 * Calculated impact of a lock on production traffic.
 */
export interface Impact {
  /** True when the lock blocks writes (ShareLock or stronger) or all reads (AccessExclusiveLock). */
  blocking: boolean;
  /** How long the lock is held relative to table size. */
  durationClass: DurationClass;
  /** Estimated wall-clock seconds the lock is held (0 for instant). */
  estSeconds: number;
  /** Estimated writes blocked during the lock window (estSeconds × writesPerSec). */
  blockedWrites: number;
}

// ─── Finding ─────────────────────────────────────────────────────────────────

/**
 * One rule violation produced by rules.ts and enriched by analyze.ts.
 * Field names follow SPEC section 4 exactly.
 */
export interface Finding {
  ruleId: RuleId;
  severity: Severity;
  /** Migration filename (e.g. "002_orders_customer_index.sql"). */
  migration: string;
  /** 0-based index of the offending statement within the migration. */
  statementIndex: number;
  /** 1-based source line of the offending statement. */
  line: number;
  /** Target table name, if applicable. */
  table: string | null;
  /** Human-readable description of the problem. */
  message: string;
  /** Explanation of why this is dangerous in production. */
  why: string;
  /** The safe rewrite pattern to use instead. */
  safePattern: string;
  /** Empirical lock data from probe.ts (absent when probe is not run). */
  evidence?: LockEvidence;
  /** Calculated production impact (absent when table stats are unavailable). */
  impact?: Impact;
}

// ─── Reports ─────────────────────────────────────────────────────────────────

/**
 * Analysis result for one migration file.
 */
export interface MigrationReport {
  /** Migration filename. */
  name: string;
  /** Repo-relative path to the .sql file. */
  filePath: string;
  /** All findings for this migration, in statement order. */
  findings: Finding[];
  /**
   * Risk score 0–100 for this migration.
   * 100 = at least one critical finding; lower scores reflect finding counts and severities.
   */
  riskScore: number;
}

/**
 * Top-level analysis result for the entire repository.
 * Emitted as locksmith-report.json and consumed by the CLI, UI, and Bob mode.
 */
export interface RepoReport {
  /** One entry per analysed migration file, in filename order. */
  migrations: MigrationReport[];
  /**
   * Overall repository risk score 0–100.
   * Computed as the maximum single-migration riskScore.
   */
  riskScore: number;
  /**
   * Gate result.
   * "fail" when any Finding has severity "critical"; "pass" otherwise.
   */
  gate: "pass" | "fail";
  /** ISO-8601 timestamp of when this report was generated. */
  generatedAt: string;
}
