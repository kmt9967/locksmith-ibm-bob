"use client";

import { useState } from "react";
import type { DemoData } from "@/lib/demo";
import type { Finding, MigrationReport, Severity } from "@/engine/types";
import { GateBadge, LockChip, RiskBar, SeverityChip, fmtInt, fmtSeconds } from "@/components/ui";

const SEV_ORDER: Severity[] = ["critical", "high", "medium", "low"];

function summarize(data: DemoData) {
  const findings = data.report?.migrations.flatMap((m) => m.findings) ?? [];
  const bySev = Object.fromEntries(SEV_ORDER.map((s) => [s, findings.filter((f) => f.severity === s).length])) as Record<Severity, number>;
  // Several rules can flag the same statement; count each statement's impact once.
  const perStatement = new Map<string, number>();
  let worst = 0;
  for (const f of findings) {
    if (!f.impact?.blocking) continue;
    worst = Math.max(worst, f.impact.estSeconds);
    perStatement.set(`${f.migration}#${f.statementIndex}`, f.impact.blockedWrites);
  }
  const blocked = [...perStatement.values()].reduce((a, b) => a + b, 0);
  return { findings, bySev, worst, blocked };
}

export function ReportView({ original, safe }: { original: DemoData; safe: DemoData }) {
  const [tab, setTab] = useState<"original" | "safe">("original");
  const data = tab === "original" ? original : safe;
  const a = summarize(original);
  const b = summarize(safe);
  const s = tab === "original" ? a : b;

  return (
    <div className="mt-8">
      <div className="inline-flex rounded-lg border border-border bg-surface p-1 text-sm" role="tablist">
        <button
          role="tab"
          aria-selected={tab === "original"}
          onClick={() => setTab("original")}
          className={`rounded-md px-3 py-1.5 ${tab === "original" ? "bg-surface-2 text-text" : "text-muted hover:text-text"}`}
        >
          As written by the team
        </button>
        <button
          role="tab"
          aria-selected={tab === "safe"}
          onClick={() => setTab("safe")}
          className={`rounded-md px-3 py-1.5 ${tab === "safe" ? "bg-surface-2 text-text" : "text-muted hover:text-text"}`}
        >
          After IBM Bob rewrite
        </button>
      </div>

      {!data.report ? (
        <div className="mt-6 rounded-lg border border-dashed border-border bg-surface p-8 text-center text-sm text-muted">
          The IBM Bob rewrite (<code>{data.dir}/</code>) has not been generated yet. Run the{" "}
          <code className="text-text">migration-surgeon</code> mode in Bob IDE — see the Bob workflow page.
        </div>
      ) : (
        <>
          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Deploy gate">
              <GateBadge gate={data.report.gate} />
            </Stat>
            <Stat label="Repository risk score">
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-semibold">{data.report.riskScore}</span>
                <span className="text-sm text-muted">/ 100</span>
                {tab === "safe" && original.report && (
                  <span className="text-sm text-safe">was {original.report.riskScore}</span>
                )}
              </div>
            </Stat>
            <Stat label="Findings">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                {SEV_ORDER.filter((x) => s.bySev[x] > 0).map((x) => (
                  <span key={x} className="flex items-center gap-1">
                    <SeverityChip severity={x} /> <span className="font-mono">{s.bySev[x]}</span>
                  </span>
                ))}
                {s.findings.length === 0 && <span className="text-safe">None</span>}
              </div>
            </Stat>
            <Stat label="Longest blocking lock (est.)">
              <div className="text-2xl font-semibold">{s.worst ? fmtSeconds(s.worst) : "—"}</div>
              <div className="text-xs text-muted">{s.blocked ? `${fmtInt(s.blocked)} writes blocked in total` : "no blocked writes"}</div>
            </Stat>
          </div>

          {tab === "safe" && <BobChanges original={original} safe={safe} />}

          <div className="mt-8 space-y-4">
            {data.report.migrations.map((m) => (
              <MigrationCard key={m.name} m={m} sql={data.sources[m.name] ?? ""} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function BobChanges({ original, safe }: { original: DemoData; safe: DemoData }) {
  const prefix = (n: string) => n.slice(0, 3);
  const before = Object.keys(original.sources);
  const after = Object.keys(safe.sources);
  const rewritten = before
    .filter((b) => !after.includes(b))
    .map((b) => ({ from: b, to: after.filter((a) => prefix(a) === prefix(b)) }));
  const risk = new Map(original.report?.migrations.map((m) => [m.name, m.riskScore]) ?? []);
  return (
    <div className="mt-6 rounded-lg border border-accent/30 bg-accent/5 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold">What IBM Bob changed</h2>
        <span className="text-xs text-muted">
          🔒 Migration Surgeon mode · 1 subagent per flagged migration · {rewritten.length} migrations →{" "}
          {rewritten.reduce((a, r) => a + r.to.length, 0)} files
        </span>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {rewritten.map((r) => (
          <div key={r.from} className="rounded-md border border-border bg-bg p-3 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-critical line-through decoration-critical/60">{r.from}</span>
              <span className="text-muted">risk {risk.get(r.from) ?? "?"} → 0</span>
            </div>
            <ul className="mt-1.5 space-y-0.5">
              {r.to.map((t) => (
                <li key={t} className="font-mono text-safe">+ {t}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-muted">
        App code updated for the rename&apos;s expand phase (dual-write <code>email</code> + <code>email_address</code>). Bob also
        withdrew its own column-drop step after noticing the app still wrote to that column. Every file below was re-checked
        by the same engine and lock probe.
      </p>
    </div>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="mb-2 text-xs uppercase tracking-wider text-muted">{label}</div>
      {children}
    </div>
  );
}

function MigrationCard({ m, sql }: { m: MigrationReport; sql: string }) {
  const [open, setOpen] = useState(m.findings.some((f) => f.severity === "critical"));
  const flagged = new Set(m.findings.map((f) => f.line));
  return (
    <div className="rounded-lg border border-border bg-surface">
      <button onClick={() => setOpen(!open)} className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left" aria-expanded={open}>
        <span className="font-mono text-sm">{m.name}</span>
        <span className="flex flex-wrap gap-1">
          {m.findings.map((f, i) => (
            <span key={i} className="font-mono text-[11px] text-muted">
              {f.ruleId}
            </span>
          ))}
        </span>
        <span className="ml-auto flex items-center gap-3">
          {m.findings.length === 0 ? <span className="text-xs text-safe">safe</span> : <RiskBar score={m.riskScore} />}
          <span className="text-muted">{open ? "−" : "+"}</span>
        </span>
      </button>
      {open && (
        <div className="grid grid-cols-1 gap-4 border-t border-border p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <pre className="overflow-x-auto rounded-md border border-border bg-bg p-3 text-xs leading-relaxed">
            {sql.split(/\r?\n/).map((line, i) => (
              <div key={i} className={flagged.has(i + 1) ? "-mx-3 border-l-2 border-critical bg-critical/10 px-3" : ""}>
                <span className="mr-3 inline-block w-5 select-none text-right text-muted">{i + 1}</span>
                {line || " "}
              </div>
            ))}
          </pre>
          <div className="space-y-3">
            {m.findings.length === 0 && <p className="text-sm text-muted">No findings. Every statement is lock-safe.</p>}
            {m.findings.map((f, i) => (
              <FindingView key={i} f={f} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function FindingView({ f }: { f: Finding }) {
  return (
    <div className="rounded-md border border-border bg-surface-2 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <SeverityChip severity={f.severity} />
        <span className="font-mono text-xs text-muted">{f.ruleId}</span>
        <span className="text-xs text-muted">line {f.line}</span>
      </div>
      <p className="mt-2 text-sm font-medium">{f.message}</p>
      <p className="mt-1 text-sm text-muted">{f.why}</p>
      {f.evidence && (
        <div className="mt-3">
          <div className="text-[11px] uppercase tracking-wider text-muted">Measured in PGlite</div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {Object.entries(f.evidence.locks).map(([rel, mode]) => (
              <LockChip key={rel} relation={rel} mode={mode} />
            ))}
            {(f.evidence as { inferred?: boolean }).inferred && (
                      <span className="rounded border border-border px-2 py-0.5 font-mono text-[11px] text-muted">inferred (CONCURRENTLY runs outside a transaction)</span>
                    )}
                    {f.evidence.rewrite && (
              <span className="rounded border border-critical/40 px-2 py-0.5 font-mono text-[11px] text-critical">table rewritten (relfilenode changed)</span>
            )}
            {f.evidence.error && (
              <span className="rounded border border-high/40 px-2 py-0.5 font-mono text-[11px] text-high">error: {f.evidence.error}</span>
            )}
          </div>
        </div>
      )}
      {f.impact && f.impact.blocking && f.impact.estSeconds > 0 && (
        <p className="mt-2 text-xs text-high">
          Est. lock held {fmtSeconds(f.impact.estSeconds)} ({f.impact.durationClass}) · ~{fmtInt(f.impact.blockedWrites)} writes blocked
        </p>
      )}
      <details className="mt-2 text-sm">
        <summary className="cursor-pointer text-accent">Safe pattern</summary>
        <p className="mt-1 whitespace-pre-line text-muted">{f.safePattern}</p>
      </details>
    </div>
  );
}
