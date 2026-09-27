import type { Severity } from "@/engine/types";

const sevStyles: Record<Severity, string> = {
  critical: "bg-critical/15 text-critical border-critical/40",
  high: "bg-high/15 text-high border-high/40",
  medium: "bg-medium/15 text-medium border-medium/40",
  low: "bg-low/15 text-low border-low/40",
};

export function SeverityChip({ severity }: { severity: Severity }) {
  return (
    <span className={`inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-[11px] uppercase tracking-wide ${sevStyles[severity]}`}>
      {severity}
    </span>
  );
}

// Postgres lock modes, weakest → strongest. ShareLock and above block writes; AccessExclusive blocks reads too.
const LOCK_ORDER = [
  "AccessShareLock",
  "RowShareLock",
  "RowExclusiveLock",
  "ShareUpdateExclusiveLock",
  "ShareLock",
  "ShareRowExclusiveLock",
  "ExclusiveLock",
  "AccessExclusiveLock",
];

export function lockBlocks(mode: string): "reads+writes" | "writes" | "none" {
  if (mode === "AccessExclusiveLock") return "reads+writes";
  return LOCK_ORDER.indexOf(mode) >= LOCK_ORDER.indexOf("ShareLock") ? "writes" : "none";
}

export function LockChip({ relation, mode }: { relation: string; mode: string }) {
  const blocks = lockBlocks(mode);
  const tone =
    blocks === "reads+writes"
      ? "border-critical/40 text-critical"
      : blocks === "writes"
        ? "border-high/40 text-high"
        : "border-safe/40 text-safe";
  return (
    <span className={`inline-flex max-w-full flex-wrap items-center gap-x-1.5 rounded border bg-bg px-2 py-0.5 font-mono text-[11px] break-all ${tone}`}>
      <span className="text-muted">{relation}</span>
      {mode}
      <span className="text-muted">· blocks {blocks}</span>
    </span>
  );
}

export function GateBadge({ gate }: { gate: "pass" | "fail" }) {
  return gate === "fail" ? (
    <span className="inline-flex items-center gap-2 rounded-md border border-critical/50 bg-critical/10 px-3 py-1 text-sm font-semibold text-critical">
      <span className="h-2 w-2 rounded-full bg-critical" /> Gate: FAIL
    </span>
  ) : (
    <span className="inline-flex items-center gap-2 rounded-md border border-safe/50 bg-safe/10 px-3 py-1 text-sm font-semibold text-safe">
      <span className="h-2 w-2 rounded-full bg-safe" /> Gate: PASS
    </span>
  );
}

export function RiskBar({ score }: { score: number }) {
  const color = score >= 80 ? "bg-critical" : score >= 50 ? "bg-high" : score >= 20 ? "bg-medium" : "bg-safe";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-surface-2">
        <div className={`h-full ${color}`} style={{ width: `${Math.max(3, score)}%` }} />
      </div>
      <span className="font-mono text-xs text-muted">{score}</span>
    </div>
  );
}

export function fmtSeconds(s: number) {
  if (s < 1) return "< 1 s";
  if (s < 90) return `${Math.round(s)} s`;
  const m = s / 60;
  return m < 90 ? `${m.toFixed(1)} min` : `${(m / 60).toFixed(1)} h`;
}

export function fmtInt(n: number) {
  return Math.round(n).toLocaleString("en-US");
}
