/**
 * rules.test.ts — Unit tests for each rule (LS001–LS012) plus an integration
 * test running analyzeRepo on demo-repo asserting the corrected acceptance table.
 */

import { describe, it, expect } from "vitest";
import path from "node:path";

import type { Statement, Migration, Finding } from "./types";
import { ls001, ls002, ls003, ls004, ls005, ls006, ls007, ls008, ls009, ls010, ls011, ls012 } from "./rules";
import type { RuleContext } from "./rules";
import { splitMigration } from "./split";
import { classifyAll } from "./classify";
import { analyzeRepo } from "./analyze";

// ─── Test helpers ─────────────────────────────────────────────────────────────

function makeStmt(overrides: Partial<Statement> = {}): Statement {
  return {
    line: 1,
    index: 0,
    kind: "OTHER",
    table: "orders",
    columns: [],
    sql: "",
    flags: {},
    ...overrides,
  };
}

function makeMigration(overrides: Partial<Migration> = {}): Migration {
  const sql = overrides.sql ?? "";
  return {
    filePath: "/repo/db/migrations/001_test.sql",
    name: "001_test.sql",
    sql,
    statements: overrides.statements ?? [],
    ...overrides,
  };
}

function makeCtx(overrides: Partial<RuleContext> = {}): RuleContext {
  return {
    tableStats: { orders: { rows: 5_000_000, writesPerSec: 100 } },
    tablesCreatedEarlier: new Set(),
    tablesCreatedInThisMigration: new Set(),
    codeIndex: new Map(),
    ...overrides,
  };
}

// ─── LS001 ────────────────────────────────────────────────────────────────────

describe("LS001 — CREATE INDEX without CONCURRENTLY", () => {
  it("fires on existing large table (>1M rows) → critical", () => {
    const stmt = makeStmt({
      kind: "CREATE_INDEX",
      table: "orders",
      flags: { concurrently: false },
    });
    const f = ls001(stmt, makeMigration(), makeCtx());
    expect(f).not.toBeNull();
    expect(f!.ruleId).toBe("LS001");
    expect(f!.severity).toBe("critical");
  });

  it("fires on existing small table → high (not critical)", () => {
    const stmt = makeStmt({
      kind: "CREATE_INDEX",
      table: "products",
      flags: { concurrently: false },
    });
    const f = ls001(stmt, makeMigration(), makeCtx({
      tableStats: { products: { rows: 56_000, writesPerSec: 2 } },
    }));
    expect(f).not.toBeNull();
    expect(f!.severity).toBe("high");
  });

  it("does NOT fire when CONCURRENTLY", () => {
    const stmt = makeStmt({
      kind: "CREATE_INDEX",
      table: "orders",
      flags: { concurrently: true },
    });
    expect(ls001(stmt, makeMigration(), makeCtx())).toBeNull();
  });

  it("does NOT fire on a table created in the same migration", () => {
    const stmt = makeStmt({
      kind: "CREATE_INDEX",
      table: "new_table",
      flags: { concurrently: false },
    });
    const ctx = makeCtx({
      tableStats: {},
      tablesCreatedEarlier: new Set(),
      tablesCreatedInThisMigration: new Set(["new_table"]),
    });
    expect(ls001(stmt, makeMigration(), ctx)).toBeNull();
  });

  it("fires on table created in an EARLIER migration (no stats)", () => {
    const stmt = makeStmt({
      kind: "CREATE_INDEX",
      table: "earlier_table",
      flags: { concurrently: false },
    });
    const ctx = makeCtx({
      tableStats: {},
      tablesCreatedEarlier: new Set(["earlier_table"]),
    });
    const f = ls001(stmt, makeMigration(), ctx);
    expect(f).not.toBeNull();
    expect(f!.severity).toBe("high"); // no stats → not critical
  });
});

// ─── LS002 ────────────────────────────────────────────────────────────────────

describe("LS002 — ADD COLUMN NOT NULL without constant DEFAULT", () => {
  it("fires on NOT NULL with no default", () => {
    const stmt = makeStmt({
      kind: "ADD_COLUMN",
      table: "orders",
      columns: ["tracking_code"],
      sql: "ALTER TABLE orders ADD COLUMN tracking_code text NOT NULL",
      flags: {},
    });
    const f = ls002(stmt, makeMigration(), makeCtx());
    expect(f).not.toBeNull();
    expect(f!.ruleId).toBe("LS002");
    expect(f!.severity).toBe("critical");
  });

  it("does NOT fire when a constant DEFAULT exists", () => {
    const stmt = makeStmt({
      kind: "ADD_COLUMN",
      table: "orders",
      columns: ["status"],
      sql: "ALTER TABLE orders ADD COLUMN status text NOT NULL DEFAULT 'pending'",
      flags: { constantDefault: true },
    });
    expect(ls002(stmt, makeMigration(), makeCtx())).toBeNull();
  });

  it("fires when a volatile DEFAULT exists (no constant default — that's LS003's domain)", () => {
    const stmt = makeStmt({
      kind: "ADD_COLUMN",
      table: "orders",
      columns: ["shipped_at"],
      sql: "ALTER TABLE orders ADD COLUMN shipped_at timestamptz NOT NULL DEFAULT now()",
      flags: { volatileDefault: true },
    });
    // volatileDefault but no constantDefault → LS002 should fire
    const f = ls002(stmt, makeMigration(), makeCtx());
    expect(f).not.toBeNull();
    expect(f!.ruleId).toBe("LS002");
  });

  it("does NOT fire on nullable column", () => {
    const stmt = makeStmt({
      kind: "ADD_COLUMN",
      table: "orders",
      columns: ["notes"],
      sql: "ALTER TABLE orders ADD COLUMN notes text",
      flags: {},
    });
    expect(ls002(stmt, makeMigration(), makeCtx())).toBeNull();
  });

  it("does NOT fire on table created in same migration", () => {
    const stmt = makeStmt({
      kind: "ADD_COLUMN",
      table: "new_table",
      columns: ["col"],
      sql: "ALTER TABLE new_table ADD COLUMN col text NOT NULL",
      flags: {},
    });
    const ctx = makeCtx({ tablesCreatedInThisMigration: new Set(["new_table"]) });
    expect(ls002(stmt, makeMigration(), ctx)).toBeNull();
  });
});

// ─── LS003 ────────────────────────────────────────────────────────────────────

describe("LS003 — ADD COLUMN with volatile DEFAULT", () => {
  it("fires on now() default", () => {
    const stmt = makeStmt({
      kind: "ADD_COLUMN",
      columns: ["shipped_at"],
      flags: { volatileDefault: true },
    });
    const f = ls003(stmt, makeMigration(), makeCtx());
    expect(f).not.toBeNull();
    expect(f!.ruleId).toBe("LS003");
    expect(f!.severity).toBe("high");
  });

  it("does NOT fire on constant default", () => {
    const stmt = makeStmt({
      kind: "ADD_COLUMN",
      flags: { constantDefault: true },
    });
    expect(ls003(stmt, makeMigration(), makeCtx())).toBeNull();
  });

  it("does NOT fire on table created in same migration", () => {
    const stmt = makeStmt({
      kind: "ADD_COLUMN",
      table: "new_table",
      flags: { volatileDefault: true },
    });
    const ctx = makeCtx({ tablesCreatedInThisMigration: new Set(["new_table"]) });
    expect(ls003(stmt, makeMigration(), ctx)).toBeNull();
  });
});

// ─── LS004 ────────────────────────────────────────────────────────────────────

describe("LS004 — ALTER COLUMN TYPE", () => {
  it("fires on large table → critical", () => {
    const stmt = makeStmt({ kind: "ALTER_TYPE", table: "orders", columns: ["total"] });
    const f = ls004(stmt, makeMigration(), makeCtx());
    expect(f).not.toBeNull();
    expect(f!.severity).toBe("critical");
  });

  it("fires on table with no stats → high", () => {
    const stmt = makeStmt({ kind: "ALTER_TYPE", table: "unknown", columns: ["col"] });
    const f = ls004(stmt, makeMigration(), makeCtx({ tableStats: {} }));
    expect(f).not.toBeNull();
    expect(f!.severity).toBe("high");
  });

  it("does NOT fire on non-ALTER_TYPE statement", () => {
    const stmt = makeStmt({ kind: "ADD_COLUMN" });
    expect(ls004(stmt, makeMigration(), makeCtx())).toBeNull();
  });
});

// ─── LS005 ────────────────────────────────────────────────────────────────────

describe("LS005 — ALTER COLUMN SET NOT NULL", () => {
  it("fires on SET_NOT_NULL", () => {
    const stmt = makeStmt({ kind: "SET_NOT_NULL", columns: ["status"] });
    const f = ls005(stmt, makeMigration(), makeCtx());
    expect(f).not.toBeNull();
    expect(f!.severity).toBe("high");
  });

  it("does not fire on ADD_COLUMN", () => {
    expect(ls005(makeStmt({ kind: "ADD_COLUMN" }), makeMigration(), makeCtx())).toBeNull();
  });
});

// ─── LS006 ────────────────────────────────────────────────────────────────────

describe("LS006 — ADD CONSTRAINT FOREIGN KEY without NOT VALID", () => {
  it("fires without NOT VALID", () => {
    const stmt = makeStmt({
      kind: "ADD_CONSTRAINT",
      sql: "ALTER TABLE order_items ADD CONSTRAINT fk FOREIGN KEY (order_id) REFERENCES orders(id)",
      flags: { notValid: false },
    });
    const f = ls006(stmt, makeMigration(), makeCtx());
    expect(f).not.toBeNull();
    expect(f!.severity).toBe("high");
  });

  it("does NOT fire with NOT VALID", () => {
    const stmt = makeStmt({
      kind: "ADD_CONSTRAINT",
      sql: "ALTER TABLE t ADD CONSTRAINT fk FOREIGN KEY (col) REFERENCES t2(id) NOT VALID",
      flags: { notValid: true },
    });
    expect(ls006(stmt, makeMigration(), makeCtx())).toBeNull();
  });

  it("does NOT fire for CHECK constraint (not FK)", () => {
    const stmt = makeStmt({
      kind: "ADD_CONSTRAINT",
      sql: "ALTER TABLE t ADD CONSTRAINT chk CHECK (col > 0)",
      flags: { notValid: false },
    });
    expect(ls006(stmt, makeMigration(), makeCtx())).toBeNull();
  });
});

// ─── LS007 ────────────────────────────────────────────────────────────────────

describe("LS007 — ADD CONSTRAINT CHECK without NOT VALID", () => {
  it("fires on CHECK without NOT VALID", () => {
    const stmt = makeStmt({
      kind: "ADD_CONSTRAINT",
      sql: "ALTER TABLE orders ADD CONSTRAINT chk_total CHECK (total > 0)",
      flags: { notValid: false },
    });
    const f = ls007(stmt, makeMigration(), makeCtx());
    expect(f).not.toBeNull();
    expect(f!.severity).toBe("medium");
  });

  it("does NOT fire with NOT VALID", () => {
    const stmt = makeStmt({
      kind: "ADD_CONSTRAINT",
      sql: "ALTER TABLE orders ADD CONSTRAINT chk_total CHECK (total > 0) NOT VALID",
      flags: { notValid: true },
    });
    expect(ls007(stmt, makeMigration(), makeCtx())).toBeNull();
  });
});

// ─── LS008 ────────────────────────────────────────────────────────────────────

describe("LS008 — RENAME COLUMN while app code references old name", () => {
  it("fires when old column name appears in code index", () => {
    const stmt = makeStmt({
      kind: "RENAME_COLUMN",
      table: "customers",
      columns: ["email", "email_address"],
      sql: "ALTER TABLE customers RENAME COLUMN email TO email_address",
    });
    const codeIndex = new Map([["email", ["src/customers.ts:5"]]]);
    const f = ls008(stmt, makeMigration(), makeCtx({ codeIndex }));
    expect(f).not.toBeNull();
    expect(f!.ruleId).toBe("LS008");
    expect(f!.severity).toBe("critical");
  });

  it("does NOT fire when old name not in code index", () => {
    const stmt = makeStmt({
      kind: "RENAME_COLUMN",
      columns: ["old_col", "new_col"],
    });
    expect(ls008(stmt, makeMigration(), makeCtx())).toBeNull();
  });

  it("fires for RENAME_TABLE too", () => {
    const stmt = makeStmt({
      kind: "RENAME_TABLE",
      table: "orders",
      columns: ["order_items_new"],
    });
    const codeIndex = new Map([["orders", ["src/orders.ts:1"]]]);
    const f = ls008(stmt, makeMigration(), makeCtx({ codeIndex }));
    expect(f).not.toBeNull();
    expect(f!.severity).toBe("critical");
  });
});

// ─── LS009 ────────────────────────────────────────────────────────────────────

describe("LS009 — DROP COLUMN/TABLE while app code references it", () => {
  it("fires on DROP COLUMN when column referenced in code", () => {
    const stmt = makeStmt({
      kind: "DROP_COLUMN",
      table: "orders",
      columns: ["status"],
    });
    const codeIndex = new Map([["status", ["src/orders.ts:5"]]]);
    const f = ls009(stmt, makeMigration(), makeCtx({ codeIndex }));
    expect(f).not.toBeNull();
    expect(f!.severity).toBe("critical");
  });

  it("fires on DROP TABLE when table referenced in code", () => {
    const stmt = makeStmt({
      kind: "DROP_TABLE",
      table: "orders",
    });
    const codeIndex = new Map([["orders", ["src/orders.ts:1"]]]);
    const f = ls009(stmt, makeMigration(), makeCtx({ codeIndex }));
    expect(f).not.toBeNull();
    expect(f!.severity).toBe("critical");
  });

  it("does NOT fire when no code references", () => {
    const stmt = makeStmt({ kind: "DROP_COLUMN", columns: ["old_col"] });
    expect(ls009(stmt, makeMigration(), makeCtx())).toBeNull();
  });
});

// ─── LS010 ────────────────────────────────────────────────────────────────────

describe("LS010 — No SET lock_timeout on heavy-lock migration", () => {
  it("fires on ALTER_TYPE without lock_timeout in migration", () => {
    const migration = makeMigration({ sql: "ALTER TABLE orders ALTER COLUMN total TYPE numeric;" });
    const stmt = makeStmt({ kind: "ALTER_TYPE" });
    const f = ls010(stmt, migration, makeCtx());
    expect(f).not.toBeNull();
    expect(f!.severity).toBe("medium");
  });

  it("does NOT fire when SET lock_timeout is present", () => {
    const migration = makeMigration({ sql: "SET lock_timeout = '3s';\nALTER TABLE orders ALTER COLUMN total TYPE numeric;" });
    const stmt = makeStmt({ kind: "ALTER_TYPE" });
    expect(ls010(stmt, migration, makeCtx())).toBeNull();
  });

  it("does NOT fire on a safe statement (UPDATE with no lock)", () => {
    const migration = makeMigration({ sql: "SELECT 1;" });
    const stmt = makeStmt({ kind: "OTHER" });
    expect(ls010(stmt, migration, makeCtx())).toBeNull();
  });

  it("fires on CREATE_INDEX (ShareLock)", () => {
    const migration = makeMigration({ sql: "CREATE INDEX idx ON orders (id);" });
    const stmt = makeStmt({ kind: "CREATE_INDEX" });
    const f = ls010(stmt, migration, makeCtx());
    expect(f).not.toBeNull();
  });
});

// ─── LS011 ────────────────────────────────────────────────────────────────────

describe("LS011 — CREATE INDEX CONCURRENTLY mixed with other statements", () => {
  it("fires when CONCURRENTLY mixed with other statements", () => {
    const rawSql = "SELECT 1;\nCREATE INDEX CONCURRENTLY idx ON products (title);";
    const statements = classifyAll(splitMigration(rawSql));
    const migration = makeMigration({ sql: rawSql, statements });
    const idxStmt = statements.find((s) => s.kind === "CREATE_INDEX")!;
    const f = ls011(idxStmt, migration, makeCtx());
    expect(f).not.toBeNull();
    expect(f!.severity).toBe("high");
  });

  it("does NOT fire when CONCURRENTLY is alone in migration", () => {
    const rawSql = "CREATE INDEX CONCURRENTLY idx ON products (title);";
    const statements = classifyAll(splitMigration(rawSql));
    const migration = makeMigration({ sql: rawSql, statements });
    const idxStmt = statements[0];
    expect(ls011(idxStmt, migration, makeCtx())).toBeNull();
  });

  it("does NOT fire on non-CONCURRENTLY CREATE INDEX", () => {
    const stmt = makeStmt({ kind: "CREATE_INDEX", flags: { concurrently: false } });
    expect(ls011(stmt, makeMigration(), makeCtx())).toBeNull();
  });
});

// ─── LS012 ────────────────────────────────────────────────────────────────────

describe("LS012 — Un-batched UPDATE/DELETE without key range", () => {
  it("fires on UPDATE with no WHERE", () => {
    const stmt = makeStmt({
      kind: "UPDATE",
      sql: "UPDATE orders SET status = 'active'",
      flags: { hasWhere: false },
    });
    const f = ls012(stmt, makeMigration(), makeCtx());
    expect(f).not.toBeNull();
    expect(f!.severity).toBe("high");
  });

  it("fires on UPDATE WHERE without key range (e.g. WHERE status IS NULL)", () => {
    const stmt = makeStmt({
      kind: "UPDATE",
      sql: "UPDATE orders SET status = 'pending' WHERE status IS NULL",
      flags: { hasWhere: true },
    });
    const f = ls012(stmt, makeMigration(), makeCtx());
    expect(f).not.toBeNull();
  });

  it("does NOT fire on UPDATE WHERE id > X", () => {
    const stmt = makeStmt({
      kind: "UPDATE",
      sql: "UPDATE orders SET status = 'active' WHERE id > 1000",
      flags: { hasWhere: true },
    });
    expect(ls012(stmt, makeMigration(), makeCtx())).toBeNull();
  });

  it("does NOT fire on UPDATE WHERE id BETWEEN x AND y", () => {
    const stmt = makeStmt({
      kind: "UPDATE",
      sql: "UPDATE orders SET status = 'done' WHERE id BETWEEN 1 AND 10000",
      flags: { hasWhere: true },
    });
    expect(ls012(stmt, makeMigration(), makeCtx())).toBeNull();
  });

  it("does NOT fire on table created in same migration", () => {
    const stmt = makeStmt({
      kind: "UPDATE",
      table: "new_table",
      sql: "UPDATE new_table SET col = 1",
      flags: { hasWhere: false },
    });
    const ctx = makeCtx({
      tableStats: {},
      tablesCreatedEarlier: new Set(),
    });
    expect(ls012(stmt, makeMigration(), ctx)).toBeNull();
  });

  it("fires on DELETE with no WHERE on existing table", () => {
    const stmt = makeStmt({
      kind: "DELETE",
      sql: "DELETE FROM orders",
      flags: { hasWhere: false },
    });
    const f = ls012(stmt, makeMigration(), makeCtx());
    expect(f).not.toBeNull();
  });
});

// ─── Integration test against demo-repo ───────────────────────────────────────

describe("analyzeRepo — demo-repo acceptance table", () => {
  const demoDir = path.resolve(__dirname, "../../demo-repo");

  it("runs without throwing", async () => {
    const report = await analyzeRepo(demoDir);
    expect(report).toBeDefined();
    expect(report.migrations.length).toBeGreaterThan(0);
    expect(report.gate).toBe("fail"); // multiple critical findings
  });

  it("001_baseline — no findings (new tables, no data yet)", async () => {
    const report = await analyzeRepo(demoDir);
    const m = report.migrations.find((m) => m.name === "001_baseline.sql")!;
    expect(m).toBeDefined();
    expect(m.findings).toHaveLength(0);
  });

  it("002 — LS001 critical + LS010 medium", async () => {
    const report = await analyzeRepo(demoDir);
    const m = report.migrations.find((m) => m.name === "002_orders_customer_index.sql")!;
    const ruleIds = m.findings.map((f) => f.ruleId);
    expect(ruleIds).toContain("LS001");
    expect(ruleIds).toContain("LS010");
    const ls001Finding = m.findings.find((f) => f.ruleId === "LS001")!;
    expect(ls001Finding.severity).toBe("critical");
    const ls010Finding = m.findings.find((f) => f.ruleId === "LS010")!;
    expect(ls010Finding.severity).toBe("medium");
    // Only one LS010 per migration
    expect(m.findings.filter((f) => f.ruleId === "LS010")).toHaveLength(1);
  });

  it("003 — LS002 (×2) critical + LS003 high + LS010 medium", async () => {
    const report = await analyzeRepo(demoDir);
    const m = report.migrations.find((m) => m.name === "003_orders_shipped_at.sql")!;
    const ruleIds = m.findings.map((f) => f.ruleId);

    // Two LS002 findings: shipped_at (volatile default, no constant) and tracking_code (no default)
    const ls002s = m.findings.filter((f) => f.ruleId === "LS002");
    expect(ls002s).toHaveLength(2);
    ls002s.forEach((f) => expect(f.severity).toBe("critical"));

    // LS003 for the volatile default on shipped_at
    expect(ruleIds).toContain("LS003");
    const ls003Finding = m.findings.find((f) => f.ruleId === "LS003")!;
    expect(ls003Finding.severity).toBe("high");

    // LS010
    expect(ruleIds).toContain("LS010");
    expect(m.findings.filter((f) => f.ruleId === "LS010")).toHaveLength(1);
  });

  it("004 — LS008 critical + LS010 medium", async () => {
    const report = await analyzeRepo(demoDir);
    const m = report.migrations.find((m) => m.name === "004_rename_customer_email.sql")!;
    const ruleIds = m.findings.map((f) => f.ruleId);
    expect(ruleIds).toContain("LS008");
    expect(ruleIds).toContain("LS010");
    const ls008Finding = m.findings.find((f) => f.ruleId === "LS008")!;
    expect(ls008Finding.severity).toBe("critical");
  });

  it("005 — LS004 critical + LS010 medium", async () => {
    const report = await analyzeRepo(demoDir);
    const m = report.migrations.find((m) => m.name === "005_orders_total_precision.sql")!;
    const ruleIds = m.findings.map((f) => f.ruleId);
    expect(ruleIds).toContain("LS004");
    expect(ruleIds).toContain("LS010");
    const ls004Finding = m.findings.find((f) => f.ruleId === "LS004")!;
    expect(ls004Finding.severity).toBe("critical");
  });

  it("006 — LS006 high + LS010 medium", async () => {
    const report = await analyzeRepo(demoDir);
    const m = report.migrations.find((m) => m.name === "006_order_items_fk.sql")!;
    const ruleIds = m.findings.map((f) => f.ruleId);
    expect(ruleIds).toContain("LS006");
    expect(ruleIds).toContain("LS010");
    const ls006Finding = m.findings.find((f) => f.ruleId === "LS006")!;
    expect(ls006Finding.severity).toBe("high");
  });

  it("007 — LS012 high + LS005 high + LS010 medium", async () => {
    const report = await analyzeRepo(demoDir);
    const m = report.migrations.find((m) => m.name === "007_backfill_status.sql")!;
    const ruleIds = m.findings.map((f) => f.ruleId);
    expect(ruleIds).toContain("LS012");
    expect(ruleIds).toContain("LS005");
    expect(ruleIds).toContain("LS010");
    const ls012Finding = m.findings.find((f) => f.ruleId === "LS012")!;
    expect(ls012Finding.severity).toBe("high");
    const ls005Finding = m.findings.find((f) => f.ruleId === "LS005")!;
    expect(ls005Finding.severity).toBe("high");
  });

  it("008 — no findings (CREATE INDEX CONCURRENTLY alone, small table)", async () => {
    const report = await analyzeRepo(demoDir);
    const m = report.migrations.find((m) => m.name === "008_products_title_search.sql")!;
    expect(m).toBeDefined();
    expect(m.findings).toHaveLength(0);
  });

  it("overall gate is 'fail' (critical findings exist)", async () => {
    const report = await analyzeRepo(demoDir);
    expect(report.gate).toBe("fail");
  });

  it("overall riskScore is 100 (critical findings present)", async () => {
    const report = await analyzeRepo(demoDir);
    expect(report.riskScore).toBe(100);
  });
});
