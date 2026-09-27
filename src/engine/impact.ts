/**
 * impact.ts — Converts LockEvidence + TableStats → Impact.
 *
 * Throughput constants from SPEC section 3 step 5:
 *   rewrite: 150,000 rows/s
 *   scan:  1,500,000 rows/s
 *   instant:         0 s
 *
 * When no LockEvidence is available (static analysis only), durationClass is
 * estimated from the Statement kind using a conservative static heuristic.
 */

import type {
  LockEvidence,
  Impact,
  DurationClass,
  TableStat,
  Statement,
} from "./types";

// ─── Constants ────────────────────────────────────────────────────────────────

const REWRITE_ROWS_PER_SEC = 150_000;
const SCAN_ROWS_PER_SEC = 1_500_000;

// Lock modes that block writes (ShareLock or stronger)
const BLOCKING_LOCK_MODES = new Set([
  "ShareLock",
  "ShareRowExclusiveLock",
  "ExclusiveLock",
  "AccessExclusiveLock",
]);

// ─── Static duration heuristic ─────────────────────────────────────────────────

/**
 * Estimate the duration class from a statement kind without probe evidence.
 * Conservative: statements known to force rewrites are classed as "rewrite";
 * scans are "scan"; everything else is "instant".
 */
export function staticDurationClass(stmt: Statement): DurationClass {
  switch (stmt.kind) {
    // Full table rewrite
    case "ALTER_TYPE":
      return "rewrite";
    case "ADD_COLUMN":
      // Volatile default forces a rewrite; constant default is instant in PG 11+
      if (stmt.flags.volatileDefault) return "rewrite";
      return "instant";

    // Full table scan
    case "CREATE_INDEX":
      return "scan";
    case "SET_NOT_NULL":
      return "scan";
    case "ADD_CONSTRAINT":
      // FK validation scans the whole table unless NOT VALID
      if (!stmt.flags.notValid) return "scan";
      return "instant";
    case "UPDATE":
    case "DELETE":
      // Without a key range, assume full scan
      return stmt.flags.hasWhere ? "scan" : "scan";

    default:
      return "instant";
  }
}

/**
 * Returns true if any lock in the evidence blocks writes (ShareLock or stronger).
 */
function evidenceIsBlocking(evidence: LockEvidence): boolean {
  return Object.values(evidence.locks).some((mode) =>
    BLOCKING_LOCK_MODES.has(mode)
  );
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Calculate the production impact of a statement.
 *
 * @param stmt    Classified statement (used for static fallback).
 * @param stats   Production table stats (may be null if table unknown).
 * @param evidence Lock evidence from probe.ts (may be null in static mode).
 */
export function calculateImpact(
  stmt: Statement,
  stats: TableStat | null,
  evidence: LockEvidence | null
): Impact {
  // ── Duration class ───────────────────────────────────────────────────────
  let durationClass: DurationClass;
  let blocking: boolean;

  if (evidence) {
    durationClass = evidence.rewrite ? "rewrite" : staticDurationClass(stmt);
    blocking = evidenceIsBlocking(evidence);
  } else {
    durationClass = staticDurationClass(stmt);
    // Static heuristic: any non-instant lock on a table is blocking
    blocking =
      durationClass !== "instant" ||
      stmt.kind === "ADD_COLUMN" ||
      stmt.kind === "DROP_COLUMN" ||
      stmt.kind === "RENAME_COLUMN" ||
      stmt.kind === "RENAME_TABLE" ||
      stmt.kind === "DROP_TABLE" ||
      stmt.kind === "ALTER_TYPE" ||
      stmt.kind === "SET_NOT_NULL" ||
      stmt.kind === "ADD_CONSTRAINT" ||
      stmt.kind === "DROP_CONSTRAINT" ||
      stmt.kind === "CREATE_INDEX";
  }

  // ── Estimated seconds ────────────────────────────────────────────────────
  let estSeconds = 0;
  if (stats && durationClass !== "instant") {
    const throughput =
      durationClass === "rewrite" ? REWRITE_ROWS_PER_SEC : SCAN_ROWS_PER_SEC;
    estSeconds = stats.rows / throughput;
  }

  // ── Blocked writes ───────────────────────────────────────────────────────
  const blockedWrites =
    blocking && stats ? estSeconds * stats.writesPerSec : 0;

  return { blocking, durationClass, estSeconds, blockedWrites };
}
