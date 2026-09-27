#!/usr/bin/env tsx
/**
 * LockSmith CLI — CI gate for PostgreSQL migrations.
 *   npm run locksmith -- --dir demo-repo [--json report.json] [--no-probe]
 * Exit code: 0 = gate pass, 1 = gate fail (critical finding), 2 = usage/runtime error.
 */
import fs from "node:fs";
import path from "node:path";
import { analyzeRepo } from "../src/engine/analyze";
import type { Finding, RepoReport } from "../src/engine/types";

const c = {
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
};

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function sevColor(f: Finding) {
  const label = f.severity.padEnd(8);
  return f.severity === "critical" ? c.red(label) : f.severity === "high" ? c.yellow(label) : c.dim(label);
}

function print(report: RepoReport) {
  for (const m of report.migrations) {
    const mark = m.findings.length === 0 ? c.green("✔") : m.findings.some((f) => f.severity === "critical") ? c.red("✖") : c.yellow("!");
    console.log(`\n${mark} ${c.bold(m.name)} ${c.dim(`risk ${m.riskScore}`)}`);
    for (const f of m.findings) {
      console.log(`   ${f.ruleId} ${sevColor(f)} line ${f.line}  ${f.message}`);
      if (f.evidence) {
        const locks = Object.entries(f.evidence.locks).map(([r, mode]) => `${r} → ${mode}`).join(", ");
        if (locks) console.log(c.dim(`      probe: ${locks}${f.evidence.rewrite ? " · table rewrite" : ""}`));
        if (f.evidence.error) console.log(c.dim(`      probe error: ${f.evidence.error}`));
      }
      if (f.impact?.blocking && f.impact.estSeconds > 0) {
        console.log(c.dim(`      impact: ~${Math.round(f.impact.estSeconds)} s lock, ~${Math.round(f.impact.blockedWrites).toLocaleString("en-US")} writes blocked`));
      }
    }
  }
  const verdict = report.gate === "fail" ? c.red(c.bold("FAIL")) : c.green(c.bold("PASS"));
  console.log(`\nrisk score ${report.riskScore}/100 · gate ${verdict}\n`);
}

async function main() {
  const dir = arg("dir");
  if (!dir) {
    console.error("usage: locksmith --dir <repo> [--json out.json] [--no-probe]");
    process.exit(2);
  }
  const abs = path.resolve(dir);
  if (!fs.existsSync(path.join(abs, "db", "migrations"))) {
    console.error(`no db/migrations directory in ${abs}`);
    process.exit(2);
  }
  const report = await analyzeRepo(abs, { probe: !process.argv.includes("--no-probe") });
  print(report);
  const out = arg("json");
  if (out) {
    fs.writeFileSync(out, JSON.stringify(report, null, 2));
    console.log(c.dim(`report written to ${out}`));
  }
  process.exit(report.gate === "fail" ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
