/**
 * analyze.ts — Orchestrator: reads migration files, table stats, and app source;
 * runs split → classify → rules; assembles MigrationReport[] → RepoReport.
 *
 * Probe hook is clearly marked; probe.ts (next task) will be merged here.
 */

import fs from "node:fs";
import path from "node:path";

import type {
  Migration,
  MigrationReport,
  RepoReport,
  TableStats,
  Statement,
  Finding,
  LockEvidence,
} from "./types";
import { splitMigration } from "./split";
import { classifyAll } from "./classify";
import { runRules, type RuleContext, type CodeIndex } from "./rules";
import { calculateImpact } from "./impact";

// ─── Options ──────────────────────────────────────────────────────────────────

export interface AnalyzeOptions {
  /**
   * When true, run the probe (PGlite) to collect empirical lock evidence.
   * Requires probe.ts to be implemented. Currently a no-op placeholder.
   */
  probe?: boolean;
}

// ─── Code index builder ───────────────────────────────────────────────────────

/**
 * Build a code index from TypeScript/JS source files in `srcDir`.
 * For every SQL string literal found, extract whole-word identifiers and map
 * them to "file:line" references.
 *
 * Strategy: scan every .ts / .js file for string literals (single-quoted,
 * double-quoted, template literals). Inside each literal, extract all
 * word-token identifiers and record file:line.
 */
export function buildCodeIndex(srcDir: string): CodeIndex {
  const index: CodeIndex = new Map();

  if (!fs.existsSync(srcDir)) return index;

  const files = walkFiles(srcDir, [".ts", ".js", ".tsx", ".jsx"]);

  for (const filePath of files) {
    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.split("\n");

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const line = lines[lineIdx];
      // Extract SQL string literals: single-quoted, double-quoted, template
      // We use a simple approach: find all string-ish content and extract identifiers.
      const stringContents = extractStringLiterals(line);
      for (const str of stringContents) {
        // Extract whole-word identifiers (SQL-relevant: letters, digits, underscore)
        const words = str.match(/\b[a-zA-Z_][a-zA-Z0-9_]*\b/g) ?? [];
        for (const word of words) {
          const key = word.toLowerCase();
          if (!index.has(key)) index.set(key, []);
          index.get(key)!.push(`${path.relative(process.cwd(), filePath)}:${lineIdx + 1}`);
        }
      }
    }
  }

  return index;
}

/** Extract content of string literals from a source line (simple heuristic). */
function extractStringLiterals(line: string): string[] {
  const results: string[] = [];
  // Match single-quoted strings (JS/SQL style)
  const single = line.matchAll(/'([^'\\]|\\.)*'/g);
  for (const m of single) results.push(m[0].slice(1, -1));
  // Match double-quoted strings
  const double = line.matchAll(/"([^"\\]|\\.)*"/g);
  for (const m of double) results.push(m[0].slice(1, -1));
  // Match template literals (backtick)
  const template = line.matchAll(/`([^`\\]|\\.)*`/g);
  for (const m of template) results.push(m[0].slice(1, -1));
  return results;
}

/** Recursively walk a directory and return all files with matching extensions. */
function walkFiles(dir: string, exts: string[]): string[] {
  const result: string[] = [];
  if (!fs.existsSync(dir)) return result;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      result.push(...walkFiles(full, exts));
    } else if (entry.isFile() && exts.some((e) => entry.name.endsWith(e))) {
      result.push(full);
    }
  }
  return result;
}

// ─── Table stats reader ───────────────────────────────────────────────────────

function readTableStats(statsPath: string): TableStats {
  if (!fs.existsSync(statsPath)) return {};
  try {
    const raw = fs.readFileSync(statsPath, "utf-8");
    return JSON.parse(raw) as TableStats;
  } catch {
    return {};
  }
}

// ─── Migration file reader ────────────────────────────────────────────────────

function readMigrations(migrationsDir: string): Migration[] {
  if (!fs.existsSync(migrationsDir)) return [];

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort(); // lexicographic = filename-prefix order

  return files.map((fileName) => {
    const filePath = path.join(migrationsDir, fileName);
    const sql = fs.readFileSync(filePath, "utf-8");
    const raw = splitMigration(sql);
    const statements = classifyAll(raw);
    return {
      filePath,
      name: fileName,
      sql,
      statements,
    };
  });
}

// ─── Risk scoring ─────────────────────────────────────────────────────────────

function riskScore(findings: Finding[]): number {
  if (findings.some((f) => f.severity === "critical")) return 100;
  if (findings.length === 0) return 0;

  let score = 0;
  for (const f of findings) {
    switch (f.severity) {
      case "high":
        score += 40;
        break;
      case "medium":
        score += 15;
        break;
      case "low":
        score += 5;
        break;
    }
  }
  return Math.min(99, score);
}

// ─── LS010 deduplication ──────────────────────────────────────────────────────

/**
 * LS010 fires once per migration. We keep only the finding for the first
 * qualifying statement.
 */
function deduplicateLS010(findings: Finding[]): Finding[] {
  const seenLS010 = new Set<string>();
  return findings.filter((f) => {
    if (f.ruleId !== "LS010") return true;
    const key = f.migration;
    if (seenLS010.has(key)) return false;
    seenLS010.add(key);
    return true;
  });
}

// ─── Validated IS NOT NULL check tracker ─────────────────────────────────────

/**
 * Try to extract the constraint name and target (table, column) from an
 * ADD CONSTRAINT … CHECK (col IS NOT NULL) statement (with or without NOT VALID).
 *
 * Returns null if the statement does not match that pattern.
 */
function parseNotNullCheck(
  stmt: Statement
): { name: string; tableCol: string } | null {
  if (stmt.kind !== "ADD_CONSTRAINT") return null;
  // Normalise: collapse whitespace, strip comments (already done by classifyAll,
  // but the raw sql field is untouched — strip inline anyway).
  const n = stmt.sql.replace(/--[^\n]*/g, " ").replace(/\s+/g, " ").trim();
  // Match: ADD CONSTRAINT <name> CHECK (<col> IS NOT NULL) [NOT VALID]
  const m = n.match(
    /ADD\s+CONSTRAINT\s+(\S+)\s+CHECK\s*\(\s*(\w+)\s+IS\s+NOT\s+NULL\s*\)/i
  );
  if (!m) return null;
  const constraintName = m[1].toLowerCase();
  const col = m[2].toLowerCase();
  const table = (stmt.table ?? "").toLowerCase();
  if (!table || !col) return null;
  return { name: constraintName, tableCol: `${table}.${col}` };
}

/**
 * Try to extract the constraint name from a VALIDATE CONSTRAINT statement.
 * These are classified as OTHER, so we match the raw SQL.
 */
function parseValidateConstraint(stmt: Statement): string | null {
  if (stmt.kind !== "OTHER") return null;
  const n = stmt.sql.replace(/--[^\n]*/g, " ").replace(/\s+/g, " ").trim();
  const m = n.match(/VALIDATE\s+CONSTRAINT\s+(\S+)/i);
  return m ? m[1].replace(/;$/, "").toLowerCase() : null;
}

/**
 * Update `validatedNotNullChecks` and `pendingNotValidChecks` in-place for
 * a single statement, before that statement's rules are evaluated.
 *
 * - ADD CONSTRAINT … CHECK (col IS NOT NULL) without NOT VALID
 *     → immediately add "table.col" to validatedNotNullChecks
 * - ADD CONSTRAINT … CHECK (col IS NOT NULL) NOT VALID
 *     → park constraint name in pendingNotValidChecks
 * - VALIDATE CONSTRAINT <name>
 *     → if name is in pendingNotValidChecks, promote to validatedNotNullChecks
 */
function updateNotNullCheckSets(
  stmt: Statement,
  pendingNotValidChecks: Map<string, string>, // constraintName → "table.col"
  validatedNotNullChecks: Set<string>
): void {
  const parsed = parseNotNullCheck(stmt);
  if (parsed) {
    if (stmt.flags.notValid) {
      pendingNotValidChecks.set(parsed.name, parsed.tableCol);
    } else {
      validatedNotNullChecks.add(parsed.tableCol);
    }
    return;
  }

  const constraintName = parseValidateConstraint(stmt);
  if (constraintName) {
    const tableCol = pendingNotValidChecks.get(constraintName);
    if (tableCol) {
      validatedNotNullChecks.add(tableCol);
      pendingNotValidChecks.delete(constraintName);
    }
  }
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Analyse a repository directory and return a full RepoReport.
 *
 * Expected layout:
 *   <dir>/db/migrations/*.sql
 *   <dir>/db/table-stats.json
 *   <dir>/src/**\/*.ts
 */
export async function analyzeRepo(
  dir: string,
  options: AnalyzeOptions = {}
): Promise<RepoReport> {
  const migrationsDir = path.join(dir, "db", "migrations");
  const statsPath = path.join(dir, "db", "table-stats.json");
  const srcDir = path.join(dir, "src");

  const tableStats = readTableStats(statsPath);
  const migrations = readMigrations(migrationsDir);
  const codeIndex = buildCodeIndex(srcDir);

  // Track tables created in earlier migrations (for rule context)
  const tablesCreatedEarlier = new Set<string>();

  // Cross-migration validated IS NOT NULL check tracker.
  // pendingNotValidChecks: constraintName → "table.col" for ADD CONSTRAINT NOT VALID checks
  //   that have not yet been VALIDATE CONSTRAINT'd.
  // validatedNotNullChecksBase: "table.col" entries that are fully validated by end of
  //   earlier migrations — used as the starting point for each new migration.
  const pendingNotValidChecksBase = new Map<string, string>();
  const validatedNotNullChecksBase = new Set<string>();

  const migrationReports: MigrationReport[] = [];

  // ── PROBE HOOK ─────────────────────────────────────────────────────────────
  // When options.probe is true, run the PGlite empirical lock probe and collect
  // lock evidence for every statement in every migration.
  //
  // probeEvidence is a map of migration.name → (statementIndex → LockEvidence)
  const probeEvidence: Map<string, Map<number, LockEvidence>> = options.probe
    ? await (await import("./probe")).runProbe(migrations)
    : new Map();
  // ── END PROBE HOOK ─────────────────────────────────────────────────────────

  for (const migration of migrations) {
    // Tables created in THIS migration (for LS001/LS002/LS003 safe-table checks)
    const tablesCreatedInThisMigration = new Set<string>();
    for (const stmt of migration.statements) {
      if (stmt.kind === "CREATE_TABLE" && stmt.table) {
        tablesCreatedInThisMigration.add(stmt.table.toLowerCase());
      }
    }

    // Per-migration copies of the IS NOT NULL check tracker.
    // We mutate these as statements are processed so that validatedNotNullChecks
    // is always current up to (but not including) the statement being evaluated.
    const pendingNotValidChecks = new Map(pendingNotValidChecksBase);
    const validatedNotNullChecks = new Set(validatedNotNullChecksBase);

    const ctx: RuleContext = {
      tableStats,
      tablesCreatedEarlier: new Set(tablesCreatedEarlier),
      tablesCreatedInThisMigration,
      codeIndex,
      validatedNotNullChecks,
    };

    const migrationProbeEvidence =
      probeEvidence.get(migration.name) ?? new Map<number, LockEvidence>();

    let findings: Finding[] = [];

    for (const stmt of migration.statements) {
      // Update the validated check sets BEFORE evaluating rules for this statement,
      // so that rules see the state as it was immediately before this statement runs.
      updateNotNullCheckSets(stmt, pendingNotValidChecks, validatedNotNullChecks);

      const stmtFindings = runRules(stmt, migration, ctx);

      // Enrich with impact data
      const evidence = migrationProbeEvidence.get(stmt.index) ?? null;
      const stats = stmt.table ? (tableStats[stmt.table.toLowerCase()] ?? null) : null;

      const enriched = stmtFindings.map((f) => {
        const impact = calculateImpact(stmt, stats, evidence);
        return {
          ...f,
          ...(evidence ? { evidence } : {}),
          impact,
        };
      });

      findings.push(...enriched);
    }

    // Deduplicate LS010 (fires once per migration)
    findings = deduplicateLS010(findings);

    const score = riskScore(findings);

    migrationReports.push({
      name: migration.name,
      filePath: migration.filePath,
      findings,
      riskScore: score,
    });

    // After processing this migration, propagate the IS NOT NULL check state
    // to the base trackers for subsequent migrations.
    for (const [k, v] of pendingNotValidChecks) {
      pendingNotValidChecksBase.set(k, v);
    }
    for (const entry of validatedNotNullChecks) {
      validatedNotNullChecksBase.add(entry);
    }

    // After processing this migration, add its created tables to the "earlier" set
    // for subsequent migrations.
    for (const stmt of migration.statements) {
      if (stmt.kind === "CREATE_TABLE" && stmt.table) {
        tablesCreatedEarlier.add(stmt.table.toLowerCase());
      }
    }
  }

  const overallRiskScore = migrationReports.reduce(
    (max, r) => Math.max(max, r.riskScore),
    0
  );
  const gate =
    migrationReports.some((r) => r.findings.some((f) => f.severity === "critical"))
      ? "fail"
      : "pass";

  return {
    migrations: migrationReports,
    riskScore: overallRiskScore,
    gate,
    generatedAt: new Date().toISOString(),
  };
}
