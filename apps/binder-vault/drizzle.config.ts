import { defineConfig } from "drizzle-kit";

/**
 * Schema authoring helper. Runtime DDL lives in
 * infra/db/migrations/20260809_01_binder_postgres.sql (applied by migrate_db.py).
 */
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url:
      process.env.BINDER_DATABASE_URL ??
      process.env.DATABASE_URL ??
      "postgresql://postgres:vault@localhost:5432/iqvault",
  },
});
