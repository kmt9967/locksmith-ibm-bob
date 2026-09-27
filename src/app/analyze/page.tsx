"use client";

import { useState } from "react";
import type { MigrationReport, RepoReport } from "@/engine/types";
import { GateBadge, LockChip, SeverityChip, fmtInt, fmtSeconds } from "@/components/ui";

const EXAMPLE_BASELINE = `CREATE TABLE accounts (
  id bigserial PRIMARY KEY,
  email text NOT NULL,
  plan text
);`;

const EXAMPLE_SQL = `ALTER TABLE accounts ADD COLUMN region text NOT NULL;
CREATE INDEX idx_accounts_email ON accounts (email);
ALTER TABLE accounts ALTER COLUMN plan SET NOT NULL;`;

export default function AnalyzePage() {
  const [baseline, setBaseline] = useState(EXAMPLE_BASELINE);
  const [sql, setSql] = useState(EXAMPLE_SQL);
  const [table, setTable] = useState("accounts");
  const [rows, setRows] = useState("5000000");
  const [wps, setWps] = useState("120");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<RepoReport | null>(null);

  async function run() {
    setLoading(true);
    setError(null);
    setReport(null);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sql,
          baseline,
          tableStats: table ? { [table]: { rows: Number(rows), writesPerSec: Number(wps) } } : {},
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setReport(json as RepoReport);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const candidate: MigrationReport | undefined = report?.migrations.find((m) => m.name === "001_candidate.sql");

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Analyze a migration</h1>
      <p className="mt-2 max-w-3xl text-sm text-muted">
        Paste the schema the migration runs against and the migration itself. LockSmith applies both in a throwaway
        embedded PostgreSQL, measures the locks each statement takes and estimates impact from the table size you
        declare. Nothing is stored.
      </p>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <label className="block">
          <span className="text-xs uppercase tracking-wider text-muted">Existing schema (baseline)</span>
          <textarea
            value={baseline}
            onChange={(e) => setBaseline(e.target.value)}
            spellCheck={false}
            className="mt-1 h-40 w-full rounded-md border border-border bg-bg p-3 font-mono text-xs outline-none focus:border-accent"
          />
        </label>
        <label className="block">
          <span className="text-xs uppercase tracking-wider text-muted">Migration to check</span>
          <textarea
            value={sql}
            onChange={(e) => setSql(e.target.value)}
            spellCheck={false}
            className="mt-1 h-40 w-full rounded-md border border-border bg-bg p-3 font-mono text-xs outline-none focus:border-accent"
          />
        </label>
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <Field label="Table" value={table} onChange={setTable} />
        <Field label="Production rows" value={rows} onChange={setRows} inputMode="numeric" />
        <Field label="Writes / sec" value={wps} onChange={setWps} inputMode="numeric" />
        <button
          onClick={run}
          disabled={loading || !sql.trim()}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-bg hover:opacity-90 disabled:opacity-50"
        >
          {loading ? "Probing locks…" : "Analyze"}
        </button>
      </div>

      {error && <div className="mt-6 rounded-md border border-critical/40 bg-critical/10 p-3 text-sm text-critical">{error}</div>}

      {report && (
        <div className="mt-8">
          <div className="flex flex-wrap items-center gap-4">
            <GateBadge gate={report.gate} />
            <span className="text-sm text-muted">risk score {report.riskScore}/100</span>
          </div>
          {report.migrations
            .filter((m) => m.name === "000_baseline.sql" && m.findings.length > 0)
            .map((m) => (
              <p key={m.name} className="mt-3 text-xs text-muted">
                Note: the baseline itself produced {m.findings.length} finding(s); they are included in the gate.
              </p>
            ))}
          <div className="mt-4 space-y-3">
            {candidate && candidate.findings.length === 0 && (
              <div className="rounded-md border border-safe/40 bg-safe/10 p-4 text-sm text-safe">No lock hazards found in this migration.</div>
            )}
            {candidate?.findings.map((f, i) => (
              <div key={i} className="rounded-md border border-border bg-surface p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <SeverityChip severity={f.severity} />
                  <span className="font-mono text-xs text-muted">{f.ruleId}</span>
                  <span className="text-xs text-muted">line {f.line}</span>
                </div>
                <p className="mt-2 text-sm font-medium">{f.message}</p>
                <p className="mt-1 text-sm text-muted">{f.why}</p>
                {f.evidence && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {Object.entries(f.evidence.locks).map(([rel, mode]) => (
                      <LockChip key={rel} relation={rel} mode={mode} />
                    ))}
                    {(f.evidence as { inferred?: boolean }).inferred && (
                      <span className="rounded border border-border px-2 py-0.5 font-mono text-[11px] text-muted">inferred (CONCURRENTLY runs outside a transaction)</span>
                    )}
                    {f.evidence.rewrite && (
                      <span className="rounded border border-critical/40 px-2 py-0.5 font-mono text-[11px] text-critical">table rewritten</span>
                    )}
                    {f.evidence.error && (
                      <span className="rounded border border-high/40 px-2 py-0.5 font-mono text-[11px] text-high">error: {f.evidence.error}</span>
                    )}
                  </div>
                )}
                {f.impact && f.impact.blocking && f.impact.estSeconds > 0 && (
                  <p className="mt-2 text-xs text-high">
                    Est. {fmtSeconds(f.impact.estSeconds)} lock · ~{fmtInt(f.impact.blockedWrites)} writes blocked
                  </p>
                )}
                <details className="mt-2 text-sm">
                  <summary className="cursor-pointer text-accent">Safe pattern</summary>
                  <p className="mt-1 whitespace-pre-line text-muted">{f.safePattern}</p>
                </details>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Field(props: { label: string; value: string; onChange: (v: string) => void; inputMode?: "numeric" }) {
  return (
    <label className="block">
      <span className="text-xs uppercase tracking-wider text-muted">{props.label}</span>
      <input
        value={props.value}
        inputMode={props.inputMode}
        onChange={(e) => props.onChange(e.target.value)}
        className="mt-1 block w-36 rounded-md border border-border bg-bg px-2 py-1.5 font-mono text-sm outline-none focus:border-accent"
      />
    </label>
  );
}
