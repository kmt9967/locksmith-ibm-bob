/**
 * classify.ts — Tags each Statement with kind, table, columns, flags.
 *
 * Handles ALTER TABLE with multiple comma-separated sub-commands by emitting
 * one classified Statement per sub-command (sharing the same line/sql).
 *
 * All matching is case-insensitive.
 */

import type { Statement, StatementKind, StatementFlags } from "./types";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function ci(s: string) {
  return new RegExp(s, "i");
}

/**
 * Strip line and block comments from SQL for easier regex matching.
 * Does NOT strip content inside strings (safe for classification purposes).
 */
function stripComments(sql: string): string {
  // Block comments
  let s = sql.replace(/\/\*[\s\S]*?\*\//g, " ");
  // Line comments
  s = s.replace(/--[^\n]*/g, " ");
  return s;
}

/** Normalise whitespace to a single space. */
function norm(sql: string): string {
  return stripComments(sql).replace(/\s+/g, " ").trim();
}

// Volatile functions that force a table rewrite when used as a DEFAULT.
const VOLATILE_FNS = [
  "now()",
  "current_timestamp",
  "statement_timestamp()",
  "clock_timestamp()",
  "timeofday()",
  "transaction_timestamp()",
  "random()",
  "gen_random_uuid()",
  "uuid_generate_v4()",
];

function isVolatileDefault(defaultExpr: string): boolean {
  const d = defaultExpr.trim().toLowerCase();
  return VOLATILE_FNS.some((fn) => d === fn || d.startsWith(fn.replace("()", "(")));
}

// ─── Sub-command splitter for ALTER TABLE ─────────────────────────────────────

/**
 * Split an ALTER TABLE body into individual action strings.
 * We split on commas that are NOT inside parentheses.
 */
function splitAlterActions(body: string): string[] {
  const actions: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === "," && depth === 0) {
      actions.push(body.slice(start, i).trim());
      start = i + 1;
    }
  }
  actions.push(body.slice(start).trim());
  return actions.filter((a) => a.length > 0);
}

// ─── DEFAULT expression extractor ─────────────────────────────────────────────

/**
 * Extract the DEFAULT expression from an ADD COLUMN definition.
 * Returns null if no DEFAULT found.
 */
function extractDefault(colDef: string): string | null {
  // Match DEFAULT <expr> — stops at NOT NULL / NULL / UNIQUE / PRIMARY / CHECK / REFERENCES
  const m = colDef.match(
    /\bDEFAULT\s+((?:(?!NOT\s+NULL\b|NULL\b|UNIQUE\b|PRIMARY\b|CHECK\b|REFERENCES\b)[^\s,][\S]*(?:\s+(?!NOT\s+NULL\b|NULL\b|UNIQUE\b|PRIMARY\b|CHECK\b|REFERENCES\b))?)*)/i
  );
  return m ? m[1].trim() : null;
}

// ─── Single-action classifiers ────────────────────────────────────────────────

interface Classified {
  kind: StatementKind;
  table: string | null;
  columns: string[];
  flags: StatementFlags;
}

function classifyAddColumn(action: string, tableName: string): Classified {
  // ADD [COLUMN] [IF NOT EXISTS] col_name type [constraints...]
  const m = action.match(
    /^ADD\s+(?:COLUMN\s+)?(?:IF\s+NOT\s+EXISTS\s+)?(\S+)\s+(.*)/i
  );
  const colName = m ? m[1].toLowerCase() : null;
  const colDef = m ? m[2] : "";

  const hasNotNull = /\bNOT\s+NULL\b/i.test(colDef);
  const defaultExpr = extractDefault(colDef);
  const hasDefault = defaultExpr !== null;
  const volatile = hasDefault && isVolatileDefault(defaultExpr!);
  const constant = hasDefault && !volatile;

  return {
    kind: "ADD_COLUMN",
    table: tableName,
    columns: colName ? [colName] : [],
    flags: {
      notValid: undefined,
      hasWhere: undefined,
      volatileDefault: volatile || undefined,
      constantDefault: constant || undefined,
    },
  };
}

function classifyDropColumn(action: string, tableName: string): Classified {
  const m = action.match(/^DROP\s+(?:COLUMN\s+)?(?:IF\s+EXISTS\s+)?(\S+)/i);
  return {
    kind: "DROP_COLUMN",
    table: tableName,
    columns: m ? [m[1].toLowerCase()] : [],
    flags: {},
  };
}

function classifyAlterColumn(action: string, tableName: string): Classified {
  // ALTER [COLUMN] col_name ...
  const m = action.match(/^ALTER\s+(?:COLUMN\s+)?(\S+)\s+(.*)/i);
  const colName = m ? m[1].toLowerCase() : null;
  const rest = m ? m[2].trim() : "";

  if (/^TYPE\b/i.test(rest) || /^SET\s+DATA\s+TYPE\b/i.test(rest)) {
    return {
      kind: "ALTER_TYPE",
      table: tableName,
      columns: colName ? [colName] : [],
      flags: {},
    };
  }
  if (/^SET\s+NOT\s+NULL\b/i.test(rest)) {
    return {
      kind: "SET_NOT_NULL",
      table: tableName,
      columns: colName ? [colName] : [],
      flags: {},
    };
  }
  if (/^DROP\s+NOT\s+NULL\b/i.test(rest)) {
    return {
      kind: "DROP_NOT_NULL",
      table: tableName,
      columns: colName ? [colName] : [],
      flags: {},
    };
  }
  return {
    kind: "OTHER",
    table: tableName,
    columns: colName ? [colName] : [],
    flags: {},
  };
}

function classifyRenameColumn(action: string, tableName: string): Classified {
  // RENAME [COLUMN] old TO new
  const m = action.match(/^RENAME\s+(?:COLUMN\s+)?(\S+)\s+TO\s+(\S+)/i);
  return {
    kind: "RENAME_COLUMN",
    table: tableName,
    columns: m ? [m[1].toLowerCase(), m[2].toLowerCase()] : [],
    flags: {},
  };
}

function classifyAddConstraint(action: string, tableName: string): Classified {
  const notValid = /\bNOT\s+VALID\b/i.test(action);
  return {
    kind: "ADD_CONSTRAINT",
    table: tableName,
    columns: [],
    flags: { notValid },
  };
}

function classifyDropConstraint(action: string, tableName: string): Classified {
  return {
    kind: "DROP_CONSTRAINT",
    table: tableName,
    columns: [],
    flags: {},
  };
}

// ─── Top-level statement classifier ──────────────────────────────────────────

/**
 * Classify a single statement.
 * If it is an ALTER TABLE with multiple comma-separated actions, returns one
 * Statement per action (each sharing the original sql/line/index).
 */
export function classifyStatement(stmt: Statement): Statement[] {
  const n = norm(stmt.sql);

  // ── CREATE INDEX ─────────────────────────────────────────────────────────
  if (/^CREATE\s+(?:UNIQUE\s+)?INDEX\b/i.test(n)) {
    const concurrently = /\bCONCURRENTLY\b/i.test(n);
    // CREATE [UNIQUE] INDEX [CONCURRENTLY] [name] ON table (...)
    const m = n.match(/\bON\s+(?:ONLY\s+)?([^\s(,]+)/i);
    const table = m ? unquote(m[1]).toLowerCase() : null;
    return [{ ...stmt, kind: "CREATE_INDEX", table, columns: [], flags: { concurrently } }];
  }

  // ── DROP INDEX ───────────────────────────────────────────────────────────
  if (/^DROP\s+INDEX\b/i.test(n)) {
    const concurrently = /\bCONCURRENTLY\b/i.test(n);
    return [{ ...stmt, kind: "DROP_INDEX", table: null, columns: [], flags: { concurrently } }];
  }

  // ── CREATE TABLE ─────────────────────────────────────────────────────────
  if (/^CREATE\s+(?:TEMP(?:ORARY)?\s+)?TABLE\b/i.test(n)) {
    const m = n.match(/\bTABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([^\s(,]+)/i);
    const table = m ? unquote(m[1]).toLowerCase() : null;
    return [{ ...stmt, kind: "CREATE_TABLE", table, columns: [], flags: {} }];
  }

  // ── DROP TABLE ───────────────────────────────────────────────────────────
  if (/^DROP\s+TABLE\b/i.test(n)) {
    const m = n.match(/\bTABLE\s+(?:IF\s+EXISTS\s+)?([^\s(,;]+)/i);
    const table = m ? unquote(m[1]).toLowerCase() : null;
    return [{ ...stmt, kind: "DROP_TABLE", table, columns: [], flags: {} }];
  }

  // ── RENAME TABLE ─────────────────────────────────────────────────────────
  if (/^ALTER\s+TABLE\b/i.test(n) && /\bRENAME\s+TO\b/i.test(n) && !/\bRENAME\s+COLUMN\b/i.test(n)) {
    // But only if the only action is RENAME TO (not a RENAME COLUMN)
    const tblM = n.match(/\bTABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?([^\s]+)/i);
    const table = tblM ? unquote(tblM[1]).toLowerCase() : null;
    const m = n.match(/\bRENAME\s+TO\s+(\S+)/i);
    const newName = m ? unquote(m[1]).toLowerCase() : null;
    return [{
      ...stmt,
      kind: "RENAME_TABLE",
      table,
      columns: newName ? [newName] : [],
      flags: {},
    }];
  }

  // ── ALTER TABLE (general — may have multiple actions) ────────────────────
  if (/^ALTER\s+TABLE\b/i.test(n)) {
    // Extract table name: ALTER TABLE [IF EXISTS] [ONLY] name ...
    const tblM = n.match(/^ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?([^\s]+)\s+(.*)/i);
    if (!tblM) {
      return [{ ...stmt, kind: "OTHER", table: null, columns: [], flags: {} }];
    }
    const tableName = unquote(tblM[1]).toLowerCase();
    const actionsStr = tblM[2];

    // Split into individual actions
    const actions = splitAlterActions(actionsStr);

    const out: Statement[] = [];
    for (const action of actions) {
      let classified: Classified;
      // NOTE: ADD CONSTRAINT must be checked before the general ADD COLUMN pattern
      // because "ADD CONSTRAINT fk_name ..." matches the `\w+\s+\w` heuristic.
      if (/^ADD\s+CONSTRAINT\b/i.test(action)) {
        classified = classifyAddConstraint(action, tableName);
      } else if (/^DROP\s+CONSTRAINT\b/i.test(action)) {
        classified = classifyDropConstraint(action, tableName);
      } else if (/^ADD\s+(?:COLUMN\b|IF\s+NOT\s+EXISTS\b|\w+\s+\w)/i.test(action)) {
        // ADD COLUMN or ADD col_name type
        classified = classifyAddColumn(action, tableName);
      } else if (/^DROP\s+(?:COLUMN\b|\w+)/i.test(action)) {
        classified = classifyDropColumn(action, tableName);
      } else if (/^ALTER\s+(?:COLUMN\b|\w)/i.test(action)) {
        classified = classifyAlterColumn(action, tableName);
      } else if (/^RENAME\s+(?:COLUMN\b|\w)/i.test(action)) {
        classified = classifyRenameColumn(action, tableName);
      } else {
        classified = { kind: "OTHER", table: tableName, columns: [], flags: {} };
      }

      out.push({
        ...stmt,
        kind: classified.kind,
        table: classified.table,
        columns: classified.columns,
        flags: classified.flags,
      });
    }

    // Re-index within the output array if multiple actions
    return out.map((s, i) => ({ ...s, index: stmt.index + i / 100 }));
  }

  // ── UPDATE ───────────────────────────────────────────────────────────────
  if (/^UPDATE\b/i.test(n)) {
    const hasWhere = /\bWHERE\b/i.test(n);
    const m = n.match(/^UPDATE\s+(?:ONLY\s+)?([^\s]+)/i);
    const table = m ? unquote(m[1]).toLowerCase() : null;
    return [{ ...stmt, kind: "UPDATE", table, columns: [], flags: { hasWhere } }];
  }

  // ── DELETE ───────────────────────────────────────────────────────────────
  if (/^DELETE\s+FROM\b/i.test(n)) {
    const hasWhere = /\bWHERE\b/i.test(n);
    const m = n.match(/^DELETE\s+FROM\s+(?:ONLY\s+)?([^\s]+)/i);
    const table = m ? unquote(m[1]).toLowerCase() : null;
    return [{ ...stmt, kind: "DELETE", table, columns: [], flags: { hasWhere } }];
  }

  // ── Fallback ─────────────────────────────────────────────────────────────
  return [{ ...stmt, kind: "OTHER", table: null, columns: [], flags: {} }];
}

/** Strip surrounding double-quotes from an identifier. */
function unquote(id: string): string {
  if (id.startsWith('"') && id.endsWith('"')) return id.slice(1, -1);
  return id;
}

/**
 * Classify all statements from a split migration.
 * Re-assigns sequential indices after expansion of multi-action ALTER TABLE.
 */
export function classifyAll(statements: Statement[]): Statement[] {
  const result: Statement[] = [];
  for (const stmt of statements) {
    const classified = classifyStatement(stmt);
    result.push(...classified);
  }
  // Re-assign clean integer indices
  return result.map((s, i) => ({ ...s, index: i }));
}
