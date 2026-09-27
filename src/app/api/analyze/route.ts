import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextResponse } from "next/server";
import { analyzeRepo } from "@/engine/analyze";

export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_SQL = 20_000;
// Maximum raw request body size in bytes (~40 KB; well above MAX_SQL but prevents
// unbounded reads before we can check sql/baseline lengths).
const MAX_BODY_BYTES = 40_000;
// Maximum number of tableStats entries accepted from a single request.
const MAX_TABLE_STATS_ENTRIES = 50;

interface Body {
  sql?: unknown;
  baseline?: unknown;
  tableStats?: unknown;
}

/**
 * POST { sql, baseline?, tableStats? } → RepoReport.
 * `baseline` is optional schema SQL (CREATE TABLEs) applied first so the probe can execute `sql`.
 * The input is written to an isolated temp directory as a two-migration repo; nothing is persisted.
 */
export async function POST(req: Request) {
  // Reject oversized bodies before attempting JSON parse to prevent
  // memory exhaustion from multi-megabyte payloads.
  const contentLength = Number(req.headers.get("content-length") ?? NaN);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: `Request body too large (max ${MAX_BODY_BYTES} bytes).` }, { status: 413 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  const sql = typeof body.sql === "string" ? body.sql : "";
  const baseline = typeof body.baseline === "string" ? body.baseline : "";
  if (!sql.trim()) return NextResponse.json({ error: "Provide the migration SQL in `sql`." }, { status: 400 });
  if (sql.length + baseline.length > MAX_SQL) {
    return NextResponse.json({ error: `SQL too large (max ${MAX_SQL} characters).` }, { status: 413 });
  }
  const stats: Record<string, { rows: number; writesPerSec: number }> = {};
  // Guard: typeof array === "object", so exclude arrays explicitly.
  if (body.tableStats && typeof body.tableStats === "object" && !Array.isArray(body.tableStats)) {
    const entries = Object.entries(body.tableStats as Record<string, unknown>)
      .slice(0, MAX_TABLE_STATS_ENTRIES);
    for (const [k, v] of entries) {
      const o = v as { rows?: unknown; writesPerSec?: unknown };
      const rows = Number(o?.rows);
      const wps = Number(o?.writesPerSec ?? 0);
      if (/^[a-z_][a-z0-9_]*$/i.test(k) && Number.isFinite(rows) && rows >= 0) {
        stats[k.toLowerCase()] = { rows, writesPerSec: Number.isFinite(wps) ? wps : 0 };
      }
    }
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "locksmith-"));
  try {
    const mig = path.join(dir, "db", "migrations");
    fs.mkdirSync(mig, { recursive: true });
    fs.mkdirSync(path.join(dir, "src"));
    if (baseline.trim()) fs.writeFileSync(path.join(mig, "000_baseline.sql"), baseline);
    fs.writeFileSync(path.join(mig, "001_candidate.sql"), sql);
    fs.writeFileSync(path.join(dir, "db", "table-stats.json"), JSON.stringify(stats));
    const report = await analyzeRepo(dir, { probe: true });
    // Strip server temp paths (they reveal host directory layout).
    for (const m of report.migrations) m.filePath = `db/migrations/${m.name}`;
    return NextResponse.json(report);
  } catch {
    // Do not echo internal error messages to callers — they can contain
    // filesystem paths and PGlite internals.
    return NextResponse.json({ error: "Analysis failed. Check your SQL syntax and try again." }, { status: 500 });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
