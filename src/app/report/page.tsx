import { loadDemo } from "@/lib/demo";
import { ReportView } from "./ReportView";

export const dynamic = "force-static";

export const metadata = { title: "Demo report — LockSmith" };

export default async function ReportPage() {
  const [original, safe] = await Promise.all([loadDemo("original"), loadDemo("safe")]);
  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <p className="text-xs uppercase tracking-widest text-muted">Demo repository · fictional</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">Shopfront — pending schema migrations</h1>
      <p className="mt-2 max-w-3xl text-sm text-muted">
        Eight migrations queued for the next release of a fictional e-commerce backend. Declared production sizes:
        orders 42M rows, order_items 118M, customers 3.2M. Every lock shown below was measured by replaying the
        migration in an embedded PostgreSQL (PGlite) and reading <code className="text-text">pg_locks</code>.
      </p>
      <ReportView original={original} safe={safe} />
    </div>
  );
}
