import { sql, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEbayConnectionStore, toPgTextArrayLiteral, type SqlExecutor } from "./store.js";

describe("toPgTextArrayLiteral", () => {
  it("emits a Postgres text[] literal instead of a record cast", () => {
    const literal = toPgTextArrayLiteral([
      "https://api.ebay.com/oauth/api_scope/sell.inventory",
      "https://api.ebay.com/oauth/api_scope/sell.fulfillment",
    ]);
    expect(literal.startsWith("{")).toBe(true);
    expect(literal).toContain("sell.inventory");
    expect(literal).not.toMatch(/^\(/);
  });
});

type Statement = { sql: string; params: unknown[] };

/**
 * Renders each statement the store issues through the real Postgres dialect, so
 * a test can assert on the SQL and its bound parameters without a database.
 */
function fakeExecutor(rows: (statement: Statement) => Record<string, unknown>[] = () => []) {
  const dialect = new PgDialect();
  const statements: Statement[] = [];
  const executor: SqlExecutor = {
    async execute(query: SQL) {
      const rendered = dialect.sqlToQuery(query);
      const statement = { sql: rendered.sql.replace(/\s+/g, " ").trim(), params: rendered.params };
      statements.push(statement);
      return { rows: rows(statement) };
    },
  };
  return { statements, exec: () => executor };
}

const SANDBOX_ROW = {
  refresh_token: "sandbox-refresh",
  access_token_expires_at: "2026-09-09T00:00:00.000Z",
  scopes: ["https://api.ebay.com/oauth/api_scope/sell.inventory"],
};

function verb(statement: Statement): string {
  return statement.sql.split(" ")[0]!.toUpperCase();
}

describe("createEbayConnectionStore", () => {
  const saved = { env: process.env.EBAY_ENV, environment: process.env.EBAY_ENVIRONMENT };

  beforeEach(() => {
    delete process.env.EBAY_ENV;
    delete process.env.EBAY_ENVIRONMENT;
  });

  afterEach(() => {
    if (saved.env == null) delete process.env.EBAY_ENV;
    else process.env.EBAY_ENV = saved.env;
    if (saved.environment == null) delete process.env.EBAY_ENVIRONMENT;
    else process.env.EBAY_ENVIRONMENT = saved.environment;
  });

  it("reads the connection row for the environment publish targets", async () => {
    process.env.EBAY_ENV = "sandbox";
    const { statements, exec } = fakeExecutor(() => [SANDBOX_ROW]);

    const token = await createEbayConnectionStore(exec).getToken({ refresh: false });

    expect(token?.refreshToken).toBe("sandbox-refresh");
    expect(statements[0]!.sql).toContain("WHERE environment = $1");
    expect(statements[0]!.params).toEqual(["sandbox"]);
  });

  // The cutover failure this guards: a leftover Sandbox row is the newest row,
  // so an unscoped read refreshes a Sandbox token against Production and eBay
  // answers a bare HTTP 400 that names neither the token nor the environment.
  it("never hands a Sandbox refresh token to Production", async () => {
    process.env.EBAY_ENV = "production";
    const { statements, exec } = fakeExecutor((statement) =>
      statement.params.includes("sandbox") ? [SANDBOX_ROW] : [],
    );

    const token = await createEbayConnectionStore(exec).getToken({ refresh: false });

    expect(token).toBeNull();
    expect(statements[0]!.params).toEqual(["production"]);
  });

  it("labels a stored token with EBAY_ENV, not the Browse comps environment", async () => {
    process.env.EBAY_ENV = "sandbox";
    process.env.EBAY_ENVIRONMENT = "production";
    const { statements, exec } = fakeExecutor(() => [{ id: "row-1" }]);

    await createEbayConnectionStore(exec).saveToken({
      accessToken: "access",
      refreshToken: "sandbox-refresh",
      expiresAt: new Date("2026-09-09T00:00:00.000Z"),
      scopes: ["https://api.ebay.com/oauth/api_scope/sell.inventory"],
    });

    const update = statements.find((s) => verb(s) === "UPDATE")!;
    expect(update.sql).toContain("WHERE environment = $");
    expect(update.params).toContain("sandbox");
    expect(update.params).not.toContain("production");
  });

  it("updates the environment's row instead of appending one per refresh", async () => {
    process.env.EBAY_ENV = "sandbox";
    const { statements, exec } = fakeExecutor(() => [{ id: "row-1" }]);

    await createEbayConnectionStore(exec).saveToken({
      accessToken: "access",
      refreshToken: "rotated-refresh",
      expiresAt: new Date("2026-09-09T00:00:00.000Z"),
      scopes: [],
    });

    expect(statements.map(verb)).toEqual(["UPDATE"]);
    expect(statements[0]!.sql).toContain("RETURNING id");
  });

  it("inserts one row the first time an environment is connected", async () => {
    process.env.EBAY_ENV = "production";
    const { statements, exec } = fakeExecutor(() => []);

    await createEbayConnectionStore(exec).saveToken({
      accessToken: "access",
      refreshToken: "production-refresh",
      expiresAt: new Date("2026-09-09T00:00:00.000Z"),
      scopes: [],
    });

    expect(statements.map(verb)).toEqual(["UPDATE", "INSERT"]);
    expect(statements[1]!.params).toContain("production");
  });

  it("disconnects only the environment it was asked for", async () => {
    process.env.EBAY_ENV = "sandbox";
    const { statements, exec } = fakeExecutor(() => []);

    await createEbayConnectionStore(exec).clearToken("operator disconnect");

    expect(statements[0]!.sql).toContain("WHERE environment = $");
    expect(statements[0]!.params).toContain("sandbox");
  });

  it("keeps a refreshed access token in memory per environment", async () => {
    process.env.EBAY_ENV = "sandbox";
    const { statements, exec } = fakeExecutor((statement) =>
      verb(statement) === "SELECT" ? [SANDBOX_ROW] : [{ id: "row-1" }],
    );
    const store = createEbayConnectionStore(exec);

    await store.saveToken({
      accessToken: "cached-access",
      refreshToken: "sandbox-refresh",
      expiresAt: new Date("2099-01-01T00:00:00.000Z"),
      scopes: [],
    });
    const token = await store.getToken({ refresh: false });

    expect(token?.accessToken).toBe("cached-access");
    expect(statements.filter((s) => verb(s) === "SELECT")).toHaveLength(1);
  });
});
