/**
 * probe.ts — Empirical lock probe using PGlite.
 *
 * For each statement in every migration, replays it inside an embedded
 * in-memory PostgreSQL instance and records:
 *   - locks: strongest lock mode per relation acquired during the statement
 *   - rewrite: whether the table's relfilenode changed (full table rewrite)
 *   - error: error message if the statement failed
 *
 * Non-transactional statements (CREATE/DROP INDEX CONCURRENTLY, VACUUM) are
 * run outside a transaction; their locks are recorded as inferred.
 *
 * After each CREATE TABLE, 50 synthetic rows are seeded so constraint checks,
 * NOT NULL, type changes and FK validations actually execute.
 */

import { PGlite } from "@electric-sql/pglite";
import type { Migration, LockEvidence, LocksByRelation } from "./types";

// ─── Lock strength ordering ───────────────────────────────────────────────────

const LOCK_ORDER: string[] = [
  "AccessShareLock",
  "RowShareLock",
  "RowExclusiveLock",
  "ShareUpdateExclusiveLock",
  "ShareLock",
  "ShareRowExclusiveLock",
  "ExclusiveLock",
  "AccessExclusiveLock",
];

function lockStrength(mode: string): number {
  const idx = LOCK_ORDER.indexOf(mode);
  return idx === -1 ? 0 : idx;
}

function strongerLock(a: string, b: string): string {
  return lockStrength(a) >= lockStrength(b) ? a : b;
}

// ─── Non-transactional statement detection ────────────────────────────────────

/**
 * Returns true when the statement must NOT run inside a transaction block.
 * PostgreSQL refuses CONCURRENTLY operations and VACUUM inside transactions.
 */
function isNonTransactional(sql: string): boolean {
  const n = sql.replace(/\s+/g, " ").trim().toUpperCase();
  return (
    /\bCONCURRENTLY\b/.test(n) ||
    /^VACUUM\b/.test(n)
  );
}

/**
 * For CONCURRENTLY operations, return the inferred lock mode and the target
 * table name (best-effort from the SQL text).
 */
function inferConcurrentlyLock(sql: string): { table: string | null; mode: string } {
  // CREATE INDEX CONCURRENTLY [name] ON table
  const ciMatch = sql.match(/\bON\s+([^\s(,]+)/i);
  // DROP INDEX CONCURRENTLY [name] — no table, lock is on the index itself
  const table = ciMatch ? ciMatch[1].replace(/^"|"$/g, "").toLowerCase() : null;
  return { table, mode: "ShareUpdateExclusiveLock" };
}

// ─── Relfilenode snapshot ─────────────────────────────────────────────────────

interface RelfilenodeMap {
  [relname: string]: string; // relfilenode as string
}

async function snapshotRelfilenodes(pg: PGlite): Promise<RelfilenodeMap> {
  try {
    const result = await pg.query<{ relname: string; relfilenode: string }>(
      `SELECT relname, relfilenode::text
       FROM pg_class
       WHERE relnamespace = 'public'::regnamespace
         AND relkind = 'r'`
    );
    const map: RelfilenodeMap = {};
    for (const row of result.rows) {
      map[row.relname] = row.relfilenode;
    }
    return map;
  } catch {
    return {};
  }
}

// ─── Lock query ──────────────────────────────────────────────────────────────

interface LockRow {
  relname: string;
  mode: string;
}

async function queryLocks(pg: PGlite): Promise<LockRow[]> {
  try {
    const result = await pg.query<LockRow>(
      `SELECT c.relname, l.mode
       FROM pg_locks l
       JOIN pg_class c ON c.oid = l.relation
       WHERE l.pid = pg_backend_pid()
         AND c.relnamespace = 'public'::regnamespace`
    );
    return result.rows;
  } catch {
    return [];
  }
}

// ─── Synthetic row seeding ────────────────────────────────────────────────────

/**
 * Column descriptor returned by information_schema query.
 */
interface ColumnInfo {
  column_name: string;
  data_type: string;
  is_nullable: string;
  column_default: string | null;
  udt_name: string;
}

/**
 * Generate a SQL literal value for a given column type (used in INSERT).
 * Returns null when the column should be skipped (e.g. has a default).
 */
function valueForType(
  dataType: string,
  udtName: string,
  rowIndex: number,
  fkMap: Map<string, string[]>
): string {
  const dt = dataType.toLowerCase();
  const udt = udtName.toLowerCase();

  // FK seed map: if we have ids for a referenced table use them
  if (fkMap.size > 0) {
    // FK columns are handled separately in seedTable
  }

  if (dt === "integer" || dt === "int" || dt === "int4" || dt === "smallint" || dt === "int2") {
    return String(rowIndex + 1);
  }
  if (dt === "bigint" || dt === "int8") {
    return String(rowIndex + 1);
  }
  if (dt.startsWith("numeric") || dt === "decimal" || dt === "real" || dt === "double precision" || dt === "float8" || dt === "float4") {
    return String((rowIndex + 1) * 1.5);
  }
  if (dt === "text" || dt.startsWith("character")) {
    return `'seed_${rowIndex + 1}'`;
  }
  if (dt === "boolean" || dt === "bool") {
    return rowIndex % 2 === 0 ? "true" : "false";
  }
  if (dt.includes("timestamp") || dt === "date" || dt === "time") {
    return `'2024-01-${String((rowIndex % 28) + 1).padStart(2, "0")}'`;
  }
  if (dt === "uuid") {
    // Generate a deterministic uuid-like value
    const hex = String(rowIndex + 1).padStart(12, "0");
    return `'00000000-0000-0000-0000-${hex}'`;
  }
  if (udt === "jsonb" || udt === "json") {
    return `'{}'`;
  }
  if (dt === "USER-DEFINED".toLowerCase() || udt === "citext") {
    return `'seed_${rowIndex + 1}'`;
  }
  // Default: try a text cast
  return `'seed_${rowIndex + 1}'`;
}

interface FKInfo {
  column_name: string;
  foreign_table_name: string;
}

async function seedTable(pg: PGlite, tableName: string): Promise<boolean> {
  try {
    // Get column definitions
    const colsResult = await pg.query<ColumnInfo>(
      `SELECT column_name, data_type, is_nullable, column_default, udt_name
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1
       ORDER BY ordinal_position`,
      [tableName]
    );
    const cols = colsResult.rows;
    if (cols.length === 0) return false;

    // Get FK info: which columns reference which tables
    const fkResult = await pg.query<FKInfo>(
      `SELECT kcu.column_name, ccu.table_name AS foreign_table_name
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name
         AND tc.table_schema = kcu.table_schema
       JOIN information_schema.constraint_column_usage ccu
         ON ccu.constraint_name = tc.constraint_name
         AND ccu.table_schema = tc.table_schema
       WHERE tc.constraint_type = 'FOREIGN KEY'
         AND tc.table_schema = 'public'
         AND tc.table_name = $1`,
      [tableName]
    );
    const fkMap = new Map<string, string>(); // col → referenced_table
    for (const fk of fkResult.rows) {
      fkMap.set(fk.column_name, fk.foreign_table_name);
    }

    // For each FK-referenced table, get the available ids
    const fkIds = new Map<string, string[]>(); // referenced_table → ids[]
    for (const refTable of new Set(fkMap.values())) {
      try {
        const idsResult = await pg.query<{ id: string }>(
          `SELECT id::text FROM ${refTable} LIMIT 50`
        );
        fkIds.set(refTable, idsResult.rows.map((r) => r.id));
      } catch {
        fkIds.set(refTable, []);
      }
    }

    // Determine which columns we'll supply values for
    // Skip: serial/bigserial (has default sequence), columns with defaults unless nullable=NO
    const insertCols: string[] = [];
    const getValueForRow = (row: ColumnInfo, rowIndex: number): string | null => {
      // If it's a serial/bigserial column (default contains 'nextval'), skip it
      if (row.column_default && /nextval/i.test(row.column_default)) return null;

      // FK column: use an id from the referenced table if available
      if (fkMap.has(row.column_name)) {
        const refTable = fkMap.get(row.column_name)!;
        const ids = fkIds.get(refTable) ?? [];
        if (ids.length === 0) {
          // No rows in referenced table, skip
          return null;
        }
        return ids[rowIndex % ids.length];
      }

      // Columns with defaults: still include if NOT NULL and no DEFAULT
      if (row.column_default !== null) {
        // Has a default — let the DB handle it (skip in INSERT)
        return null;
      }

      return valueForType(row.data_type, row.udt_name, rowIndex, fkIds);
    };

    // First pass: determine columns to include (check if any row can contribute)
    const testValues: (string | null)[] = cols.map((c) => getValueForRow(c, 0));
    for (let i = 0; i < cols.length; i++) {
      if (testValues[i] !== null) {
        insertCols.push(cols[i].column_name);
      }
    }

    if (insertCols.length === 0) {
      // All columns have defaults or are serial — use DEFAULT VALUES
      for (let i = 0; i < 50; i++) {
        try {
          await pg.exec(`INSERT INTO ${tableName} DEFAULT VALUES`);
        } catch {
          // ignore individual row failures
        }
      }
      return true;
    }

    // Build 50 inserts
    let anySuccess = false;
    for (let rowIdx = 0; rowIdx < 50; rowIdx++) {
      const values: string[] = [];
      const usedCols: string[] = [];
      for (const col of cols) {
        const v = getValueForRow(col, rowIdx);
        if (v !== null) {
          usedCols.push(`"${col.column_name}"`);
          values.push(v);
        }
      }
      if (usedCols.length === 0) continue;
      const sql = `INSERT INTO "${tableName}" (${usedCols.join(", ")}) VALUES (${values.join(", ")})`;
      try {
        await pg.exec(sql);
        anySuccess = true;
      } catch {
        // Skip individual row failures
      }
    }
    return anySuccess;
  } catch {
    return false;
  }
}

// ─── Main probe function ──────────────────────────────────────────────────────

/**
 * Extended LockEvidence that may carry the `inferred` flag for CONCURRENTLY
 * locks (documented, not measured).
 */
export interface ProbeLockEvidence extends LockEvidence {
  /** True when locks were not measured but inferred from documented PostgreSQL behaviour. */
  inferred?: boolean;
}

/**
 * Run the empirical lock probe for all migrations.
 *
 * Returns a nested Map: migration.name → (statementIndex → ProbeLockEvidence).
 *
 * One PGlite instance is created and always closed, even on error.
 */
export async function runProbe(
  migrations: Migration[]
): Promise<Map<string, Map<number, ProbeLockEvidence>>> {
  const pg = new PGlite();
  await pg.waitReady;

  const result = new Map<string, Map<number, ProbeLockEvidence>>();

  try {
    for (const migration of migrations) {
      const migEvidence = new Map<number, ProbeLockEvidence>();
      result.set(migration.name, migEvidence);

      for (const stmt of migration.statements) {
        const sql = stmt.sql.trim();
        if (!sql) continue;

        if (isNonTransactional(sql)) {
          // ── Non-transactional path ────────────────────────────────────────
          // Run directly (outside transaction); record error if it fails.
          // For CONCURRENTLY, record lock as inferred ShareUpdateExclusiveLock.
          let errorText: string | null = null;
          try {
            await pg.exec(sql);
          } catch (e: unknown) {
            errorText = e instanceof Error ? e.message : String(e);
          }

          const locks: LocksByRelation = {};
          const isConc = /\bCONCURRENTLY\b/i.test(sql);
          if (isConc) {
            const { table, mode } = inferConcurrentlyLock(sql);
            if (table) locks[table] = mode;
          }

          migEvidence.set(stmt.index, {
            locks,
            rewrite: false,
            error: errorText,
            inferred: isConc ? true : undefined,
          });
        } else {
          // ── Transactional path ────────────────────────────────────────────
          // 1. Snapshot relfilenodes before
          const preSnapshot = await snapshotRelfilenodes(pg);

          // 2. BEGIN; <stmt>; read locks; ROLLBACK
          const locks: LocksByRelation = {};
          let errorText: string | null = null;

          try {
            await pg.exec("BEGIN");
            try {
              await pg.exec(sql);
              // Read locks held by this backend inside the transaction
              const lockRows = await queryLocks(pg);
              for (const row of lockRows) {
                const prev = locks[row.relname];
                locks[row.relname] = prev ? strongerLock(prev, row.mode) : row.mode;
              }
            } catch (e: unknown) {
              errorText = e instanceof Error ? e.message : String(e);
            }
          } finally {
            try {
              await pg.exec("ROLLBACK");
            } catch {
              // ignore rollback errors
            }
          }

          // 3. Re-apply for real (outside transaction) so later migrations see schema
          let rewrite = false;
          if (errorText === null) {
            try {
              await pg.exec(sql);
              // Check relfilenode change
              const postSnapshot = await snapshotRelfilenodes(pg);
              if (stmt.table) {
                const pre = preSnapshot[stmt.table];
                const post = postSnapshot[stmt.table];
                if (pre !== undefined && post !== undefined && pre !== post) {
                  rewrite = true;
                }
              }
            } catch (e: unknown) {
              // Real execution failed (e.g. ADD COLUMN NOT NULL without DEFAULT on seeded table)
              errorText = e instanceof Error ? e.message : String(e);
            }
          }

          migEvidence.set(stmt.index, {
            locks,
            rewrite,
            error: errorText,
          });

          // 4. After CREATE TABLE, seed 50 synthetic rows
          if (stmt.kind === "CREATE_TABLE" && stmt.table && errorText === null) {
            await seedTable(pg, stmt.table);
          }
        }
      }
    }
  } finally {
    await pg.close();
  }

  return result;
}
