/**
 * probe.test.ts — Tests for the empirical lock probe (PGlite).
 *
 * Each test creates an isolated set of migrations, runs the probe, and
 * asserts the lock evidence collected.
 */

import { describe, it, expect } from "vitest";
import path from "node:path";

import { runProbe } from "./probe";
import { analyzeRepo } from "./analyze";
import type { Migration, Statement } from "./types";
import { splitMigration } from "./split";
import { classifyAll } from "./classify";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeMigration(name: string, sql: string): Migration {
  const raw = splitMigration(sql);
  const statements = classifyAll(raw);
  return {
    filePath: `/fake/${name}`,
    name,
    sql,
    statements,
  };
}

// ─── CREATE INDEX → ShareLock ─────────────────────────────────────────────────

describe("probe: CREATE INDEX", () => {
  it("records ShareLock on the target table", async () => {
    const migrations: Migration[] = [
      makeMigration("001_create.sql", `
        CREATE TABLE items (id serial PRIMARY KEY, val integer NOT NULL);
      `),
      makeMigration("002_index.sql", `
        CREATE INDEX idx_items_val ON items (val);
      `),
    ];

    const evidence = await runProbe(migrations);
    const migEvidence = evidence.get("002_index.sql");
    expect(migEvidence).toBeDefined();

    // Find the CREATE INDEX statement (index 0)
    const e = migEvidence!.get(0);
    expect(e).toBeDefined();
    expect(e!.error).toBeNull();
    // ShareLock or AccessExclusiveLock acquired on the items table
    const tablelock = e!.locks["items"];
    expect(tablelock).toBeDefined();
    // ShareLock is the minimum; any lock at or above counts
    const validLocks = ["ShareLock", "ShareRowExclusiveLock", "ExclusiveLock", "AccessExclusiveLock"];
    expect(validLocks).toContain(tablelock);
  }, 60_000);
});

// ─── ALTER COLUMN TYPE → AccessExclusiveLock + rewrite ────────────────────────

describe("probe: ALTER COLUMN TYPE", () => {
  it("records AccessExclusiveLock and rewrite=true on a seeded table", async () => {
    const migrations: Migration[] = [
      makeMigration("001_create.sql", `
        CREATE TABLE widgets (id serial PRIMARY KEY, price integer NOT NULL);
      `),
      makeMigration("002_alter_type.sql", `
        ALTER TABLE widgets ALTER COLUMN price TYPE bigint;
      `),
    ];

    const evidence = await runProbe(migrations);
    const migEvidence = evidence.get("002_alter_type.sql");
    expect(migEvidence).toBeDefined();

    const e = migEvidence!.get(0);
    expect(e).toBeDefined();
    expect(e!.error).toBeNull();

    // AccessExclusiveLock on the table
    const tablelock = e!.locks["widgets"];
    expect(tablelock).toBe("AccessExclusiveLock");

    // Rewrite should be detected (relfilenode changes)
    expect(e!.rewrite).toBe(true);
  }, 60_000);
});

// ─── ADD COLUMN NOT NULL without DEFAULT on seeded table → error ──────────────

describe("probe: ADD COLUMN NOT NULL without DEFAULT", () => {
  it("records an error on a seeded non-empty table", async () => {
    const migrations: Migration[] = [
      makeMigration("001_create.sql", `
        CREATE TABLE orders2 (id serial PRIMARY KEY, total integer NOT NULL);
      `),
      makeMigration("002_add_nn.sql", `
        ALTER TABLE orders2 ADD COLUMN code text NOT NULL;
      `),
    ];

    const evidence = await runProbe(migrations);
    const migEvidence = evidence.get("002_add_nn.sql");
    expect(migEvidence).toBeDefined();

    const e = migEvidence!.get(0);
    expect(e).toBeDefined();
    // Error because the table has rows but no DEFAULT is provided
    expect(e!.error).not.toBeNull();
    expect(typeof e!.error).toBe("string");
  }, 60_000);
});

// ─── CREATE INDEX CONCURRENTLY → inferred ShareUpdateExclusiveLock ────────────

describe("probe: CREATE INDEX CONCURRENTLY", () => {
  it("records inferred ShareUpdateExclusiveLock with inferred=true", async () => {
    const migrations: Migration[] = [
      makeMigration("001_create.sql", `
        CREATE TABLE products2 (id serial PRIMARY KEY, sku text NOT NULL);
      `),
      makeMigration("002_idx_conc.sql", `
        CREATE INDEX CONCURRENTLY idx_products2_sku ON products2 (sku);
      `),
    ];

    const evidence = await runProbe(migrations);
    const migEvidence = evidence.get("002_idx_conc.sql");
    expect(migEvidence).toBeDefined();

    const e = migEvidence!.get(0);
    expect(e).toBeDefined();

    // Lock is inferred (not measured) because CONCURRENTLY can't run in transaction
    expect(e!.inferred).toBe(true);
    expect(e!.locks["products2"]).toBe("ShareUpdateExclusiveLock");
  }, 60_000);
});

// ─── Integration: demo-repo with probe: true ──────────────────────────────────

describe("probe: demo-repo integration with probe: true", () => {
  const demoDir = path.resolve(__dirname, "../../demo-repo");

  it("runs analyzeRepo with probe:true and attaches evidence to findings", async () => {
    const report = await analyzeRepo(demoDir, { probe: true });
    expect(report).toBeDefined();
    expect(report.migrations.length).toBeGreaterThan(0);

    // Gate is still fail (critical findings remain)
    expect(report.gate).toBe("fail");

    // At least one finding should have evidence attached
    const allFindings = report.migrations.flatMap((m) => m.findings);
    const withEvidence = allFindings.filter((f) => f.evidence !== undefined);
    expect(withEvidence.length).toBeGreaterThan(0);

    // Evidence on CREATE INDEX in migration 002 should show a lock on the table
    const m002 = report.migrations.find((m) => m.name === "002_orders_customer_index.sql");
    expect(m002).toBeDefined();
    const ls001Finding = m002!.findings.find((f) => f.ruleId === "LS001");
    if (ls001Finding?.evidence) {
      // Expect some lock on orders
      expect(Object.keys(ls001Finding.evidence.locks).length).toBeGreaterThan(0);
    }
  }, 120_000);
});
