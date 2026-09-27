import fs from "node:fs";
import path from "node:path";
import { analyzeRepo } from "@/engine/analyze";
import type { RepoReport } from "@/engine/types";

export type Variant = "original" | "safe";

export interface DemoData {
  variant: Variant;
  dir: string;
  report: RepoReport | null;
  sources: Record<string, string>;
}

const DIRS: Record<Variant, string> = { original: "demo-repo", safe: "demo-repo-safe" };

/** Runs the engine (with the PGlite lock probe) on one of the bundled demo repositories. */
export async function loadDemo(variant: Variant): Promise<DemoData> {
  const dir = path.join(process.cwd(), DIRS[variant]);
  const migDir = path.join(dir, "db", "migrations");
  if (!fs.existsSync(migDir)) return { variant, dir: DIRS[variant], report: null, sources: {} };
  const sources: Record<string, string> = {};
  for (const f of fs.readdirSync(migDir).filter((f) => f.endsWith(".sql")).sort()) {
    sources[f] = fs.readFileSync(path.join(migDir, f), "utf8");
  }
  const report = await analyzeRepo(dir, { probe: true });
  // Never ship absolute build-machine paths to the client.
  for (const m of report.migrations) m.filePath = `${DIRS[variant]}/db/migrations/${m.name}`;
  return { variant, dir: DIRS[variant], report, sources };
}
