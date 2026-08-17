import { describe, expect, it } from "vitest";
import { interpretBinderDb, redactDsn } from "./vipWrite";

describe("redactDsn", () => {
  it("strips URL passwords", () => {
    expect(redactDsn("postgresql://postgres:vault@localhost:5432/iqvault")).toBe(
      "postgresql://postgres:***@localhost:5432/iqvault",
    );
  });
});

describe("interpretBinderDb", () => {
  it("accepts the current Postgres Binder API", () => {
    const result = interpretBinderDb({
      store: "postgres",
      available: true,
      dbPath: "postgresql://postgres:vault@localhost:5432/iqvault",
      filledSlots: 324,
    });
    expect(result.ok).toBe(true);
    expect(result.binderDb).toEqual({
      store: "postgres",
      available: true,
      path: "postgresql://postgres:***@localhost:5432/iqvault",
      filledSlots: 324,
    });
  });

  it("rejects leftover SQLite Binder API", () => {
    const result = interpretBinderDb({
      store: "sqlite",
      available: true,
      path: "D:\\Projects\\Business_Ideas\\258_Labs\\IQVault\\apps\\binder-vault\\.data\\binder-vault.sqlite",
      filledSlots: 236,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/SQLite/);
    expect(result.hint).toMatch(/npm run api/);
    expect(result.binderDb?.store).toBe("sqlite");
  });

  it("rejects a sqlite file even if store is omitted", () => {
    const result = interpretBinderDb({
      dbPath: "/apps/binder-vault/.data/binder-vault.sqlite",
      filledSlots: 1,
    });
    expect(result.ok).toBe(false);
    expect(result.binderDb?.store).toBe("sqlite");
  });
});
