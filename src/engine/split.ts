/**
 * split.ts — Splits a raw SQL string into Statement[] (partial, pre-classify).
 *
 * Handles:
 *   - -- line comments
 *   - /* block comments *\/
 *   - single-quoted strings (with '' escaping)
 *   - dollar-quoted bodies ($$ and $tag$)
 *   - semicolons as statement terminators
 *
 * Returns an array of objects with `sql` (trimmed, no trailing semicolon) and
 * `line` (1-based line number of the first non-whitespace token).
 */

import type { Statement } from "./types";

export interface RawStatement {
  /** Trimmed SQL text (no trailing semicolon). */
  sql: string;
  /** 1-based line number where the statement starts (first non-ws token). */
  line: number;
}

/**
 * Split a full migration SQL string into raw statements.
 * Adds placeholder values for fields filled by classify.ts.
 */
export function splitStatements(sql: string): RawStatement[] {
  const results: RawStatement[] = [];
  const len = sql.length;
  let i = 0;
  // Current statement accumulator
  let stmtStart = -1; // char index of first non-ws token in current stmt
  let stmtLine = 1; // line of stmtStart
  let buf = "";
  let currentLine = 1;

  function charLine(pos: number): number {
    // Count newlines up to pos — only called for dollar-tag detection, not hot path
    let l = 1;
    for (let k = 0; k < pos; k++) {
      if (sql[k] === "\n") l++;
    }
    return l;
  }

  while (i < len) {
    const ch = sql[i];

    // ── Line comment ────────────────────────────────────────────────────────
    if (ch === "-" && sql[i + 1] === "-") {
      // Consume until end of line
      while (i < len && sql[i] !== "\n") {
        buf += sql[i++];
      }
      continue;
    }

    // ── Block comment ───────────────────────────────────────────────────────
    if (ch === "/" && sql[i + 1] === "*") {
      buf += sql[i++]; // /
      buf += sql[i++]; // *
      while (i < len) {
        if (sql[i] === "\n") currentLine++;
        buf += sql[i];
        if (sql[i] === "*" && sql[i + 1] === "/") {
          buf += sql[++i]; // /
          i++;
          break;
        }
        i++;
      }
      continue;
    }

    // ── Single-quoted string ────────────────────────────────────────────────
    if (ch === "'") {
      if (stmtStart === -1) { stmtStart = i; stmtLine = currentLine; }
      buf += sql[i++];
      while (i < len) {
        if (sql[i] === "\n") currentLine++;
        buf += sql[i];
        if (sql[i] === "'" && sql[i + 1] === "'") {
          buf += sql[++i]; // second '
          i++;
          continue;
        }
        if (sql[i] === "'") { i++; break; }
        i++;
      }
      continue;
    }

    // ── Dollar-quoted string ────────────────────────────────────────────────
    if (ch === "$") {
      // Try to parse a dollar-quote tag: $tag$
      let tagEnd = i + 1;
      while (tagEnd < len && sql[tagEnd] !== "$" && sql[tagEnd] !== "\n" && sql[tagEnd] !== " ") {
        tagEnd++;
      }
      if (tagEnd < len && sql[tagEnd] === "$") {
        const tag = sql.slice(i, tagEnd + 1); // e.g. "$$" or "$body$"
        if (stmtStart === -1) { stmtStart = i; stmtLine = currentLine; }
        buf += tag;
        i = tagEnd + 1;
        // Consume until closing tag
        while (i < len) {
          if (sql[i] === "\n") currentLine++;
          if (sql.slice(i, i + tag.length) === tag) {
            buf += tag;
            i += tag.length;
            break;
          }
          buf += sql[i++];
        }
        continue;
      }
    }

    // ── Newline ─────────────────────────────────────────────────────────────
    if (ch === "\n") {
      currentLine++;
      buf += ch;
      i++;
      continue;
    }

    // ── Semicolon = statement terminator ───────────────────────────────────
    if (ch === ";") {
      const trimmed = buf.trim();
      if (trimmed.length > 0) {
        results.push({ sql: trimmed, line: stmtLine });
      }
      buf = "";
      stmtStart = -1;
      stmtLine = currentLine;
      i++;
      continue;
    }

    // ── Regular character ───────────────────────────────────────────────────
    if (stmtStart === -1 && ch !== " " && ch !== "\t" && ch !== "\r") {
      stmtStart = i;
      stmtLine = currentLine;
    }
    buf += ch;
    i++;
  }

  // Trailing statement without semicolon
  const trimmed = buf.trim();
  if (trimmed.length > 0) {
    results.push({ sql: trimmed, line: stmtLine });
  }

  return results;
}

/**
 * Produce Statement[] from a migration SQL string.
 * kind/table/columns/flags are left as defaults; classify.ts fills them.
 */
export function splitMigration(sql: string): Statement[] {
  const raw = splitStatements(sql);
  return raw.map((r, idx) => ({
    line: r.line,
    index: idx,
    kind: "OTHER" as const,
    table: null,
    columns: [],
    sql: r.sql,
    flags: {},
  }));
}
