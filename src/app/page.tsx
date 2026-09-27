import Link from "next/link";

const steps = [
  {
    n: "01",
    title: "Detect",
    body: "12 deterministic rules read every statement in db/migrations — non-concurrent indexes, NOT NULL adds, type changes, validated constraints, renames still referenced by code.",
  },
  {
    n: "02",
    title: "Prove",
    body: "Each statement is replayed inside a real embedded PostgreSQL (PGlite). LockSmith reads pg_locks and relfilenode to record the lock actually taken and whether the table is rewritten.",
  },
  {
    n: "03",
    title: "Rewrite with IBM Bob",
    body: "A custom Bob mode, migration-surgeon, turns each flagged migration into a safe expand → backfill → contract sequence — one Bob subagent per migration, in parallel.",
  },
  {
    n: "04",
    title: "Re-verify & gate",
    body: "Bob's rewrite goes back through the same engine and lock probe. The CLI exits non-zero while any critical finding remains, so CI blocks the unsafe deploy.",
  },
];

export default function Home() {
  return (
    <div>
      <section className="grid-bg border-b border-border">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
          <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-xs text-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-safe" /> Release workflow · PostgreSQL · IBM Bob 2.0
          </p>
          <h1 className="max-w-3xl text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
            Catch the migration that locks production — <span className="text-accent">before you ship it.</span>
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-relaxed text-muted sm:text-lg">
            A one-line <code className="rounded bg-surface-2 px-1.5 py-0.5 text-sm text-text">CREATE INDEX</code> can block every
            write to a 42-million-row table for minutes. Diffs don&apos;t show it. LockSmith measures it, explains it, and has
            IBM Bob rewrite it into a zero-downtime sequence you can verify.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/report" className="rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-bg hover:opacity-90">
              Open the demo report
            </Link>
            <Link href="/analyze" className="rounded-md border border-border bg-surface px-4 py-2.5 text-sm font-medium hover:border-muted">
              Analyze your own migration
            </Link>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
        <h2 className="text-sm font-medium uppercase tracking-widest text-muted">How it works</h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((s) => (
            <div key={s.n} className="rounded-lg border border-border bg-surface p-5">
              <div className="font-mono text-xs text-accent">{s.n}</div>
              <h3 className="mt-2 font-semibold">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-16 sm:px-6">
        <div className="rounded-lg border border-border bg-surface p-6">
          <h2 className="text-xl font-semibold">Why this workflow</h2>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted">
            Schema changes ship through the same pull-request review as application code, but their risk depends on
            Postgres lock semantics and table size — knowledge most reviewers don&apos;t carry in their head. The safe
            rewrite is tedious, error-prone senior-engineer work. LockSmith turns that review into a measured, repeatable
            gate and hands the rewrite to IBM Bob.
          </p>
        </div>
      </section>
    </div>
  );
}
