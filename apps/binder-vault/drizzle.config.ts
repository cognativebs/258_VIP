import type { Config } from "drizzle-kit";

// drizzle-kit is optional here (runtime creates tables idempotently on boot).
export default {
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "turso",
  dbCredentials: {
    url: `file:${process.env.BINDER_DB_PATH ?? "./.data/binder-vault.sqlite"}`,
  },
} satisfies Config;
