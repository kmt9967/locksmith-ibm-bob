import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextResponse } from "next/server";
import { analyzeRepo } from "@/engine/analyze";

export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_SQL = 20_000;

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
  let stats: Record<string, { rows: number; writesPerSec: number }> = {};
  if (body.tableStats && typeof body.tableStats === "object") {
    for (const [k, v] of Object.entries(body.tableStats as Record<string, unknown>)) {
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
    return NextResponse.json(report);
  } catch (e) {
    return NextResponse.json({ error: `Analysis failed: ${(e as Error).message}` }, { status: 500 });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
