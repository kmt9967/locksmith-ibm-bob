import fs from "node:fs";
import path from "node:path";
import Image from "next/image";
import tasks from "@/data/bob-tasks.json";

export const dynamic = "force-static";
export const metadata = { title: "IBM Bob workflow — LockSmith" };

function readIfExists(rel: string): string | null {
  const p = path.join(process.cwd(), rel);
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null;
}

interface BobTask {
  n: number;
  title: string;
  feature: string;
  summary: string;
  files: string[];
  outcome: string;
  bobcoins: number | null;
  screenshot: string | null;
}

export default function BobPage() {
  const modeYaml = readIfExists(".bob/custom_modes.yaml");
  const skill = readIfExists(".bob/skills/lock-audit/SKILL.md");
  const list = tasks as BobTask[];
  const total = list.reduce((a, t) => a + (t.bobcoins ?? 0), 0);

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <p className="text-xs uppercase tracking-widest text-muted">IBM Bob 2.0 · core component</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">How IBM Bob runs inside LockSmith</h1>
      <p className="mt-2 max-w-3xl text-sm text-muted">
        LockSmith&apos;s detector and lock probe are deterministic. The part that needs judgement — turning a dangerous
        migration into a safe multi-step rollout and updating the application code that depends on it — is done by IBM Bob,
        through a custom mode and skill that ship in this repository&apos;s <code className="text-text">.bob/</code> folder.
        Bob also built most of the engine itself; every session is listed below with its real task summary.
      </p>

      <div className="mt-8 grid grid-cols-1 gap-4 lg:grid-cols-3">
        {[
          ["1. Report", "npm run locksmith -- --dir <repo> --json locksmith-report.json produces the findings with measured lock evidence."],
          ["2. Rewrite (Bob)", "In Bob IDE, switch to 🔒 Migration Surgeon and run the lock-audit skill. Bob spawns one subagent per flagged migration and rewrites it into expand → backfill → contract steps."],
          ["3. Re-verify", "Bob re-runs the LockSmith gate on its own output and writes locksmith-summary.md with the before/after score. CI blocks the merge until the gate passes."],
        ].map(([t, b]) => (
          <div key={t} className="rounded-lg border border-border bg-surface p-5">
            <h2 className="font-semibold">{t}</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted">{b}</p>
          </div>
        ))}
      </div>

      {modeYaml && (
        <section className="mt-10">
          <h2 className="text-lg font-semibold">The custom mode (<code>.bob/custom_modes.yaml</code>)</h2>
          <pre className="mt-3 max-h-96 overflow-auto rounded-md border border-border bg-bg p-4 text-xs leading-relaxed">{modeYaml}</pre>
        </section>
      )}
      {skill && (
        <section className="mt-8">
          <h2 className="text-lg font-semibold">The skill (<code>.bob/skills/lock-audit/SKILL.md</code>)</h2>
          <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-bg p-4 text-xs leading-relaxed">{skill}</pre>
        </section>
      )}

      <section className="mt-10">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold">Bob task sessions used to build LockSmith</h2>
          <span className="text-sm text-muted">{list.length} tasks · {total.toFixed(2)} Bobcoins in these task summaries (account usage 13.07 of 40, incl. one aborted prompt)</span>
        </div>
        <div className="mt-4 space-y-4">
          {list.map((t) => (
            <div key={t.n} className="grid grid-cols-1 gap-4 rounded-lg border border-border bg-surface p-4 md:grid-cols-[minmax(0,1fr)_320px]">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-accent">TASK {String(t.n).padStart(2, "0")}</span>
                  <span className="rounded border border-border px-1.5 py-0.5 text-[11px] text-muted">{t.feature}</span>
                  {t.bobcoins != null && <span className="text-[11px] text-muted">{t.bobcoins} Bobcoins</span>}
                </div>
                <h3 className="mt-2 font-semibold">{t.title}</h3>
                <p className="mt-1 text-sm text-muted">{t.summary}</p>
                <p className="mt-2 text-sm">{t.outcome}</p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {t.files.map((f) => (
                    <code key={f} className="rounded bg-surface-2 px-1.5 py-0.5 text-[11px] text-muted">{f}</code>
                  ))}
                </div>
              </div>
              {t.screenshot && (
                <a href={`/bob-sessions/${t.screenshot}`} target="_blank" rel="noreferrer" className="block">
                  <Image
                    src={`/bob-sessions/${t.screenshot}`}
                    alt={`IBM Bob task ${t.n} session summary`}
                    width={1366}
                    height={728}
                    className="h-auto w-full rounded border border-border"
                  />
                </a>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
