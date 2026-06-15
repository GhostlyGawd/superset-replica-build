import { defineConfig } from "drizzle-kit";

/**
 * drizzle-kit config (ADR-0003). Dialect is Postgres so the generated SQL runs
 * unchanged on embedded PGlite (default) and a real Postgres server. `generate`
 * needs no live connection; the SQL in ./migrations is applied programmatically
 * on store open (see src/store.ts) so a fresh user gets a ready DB.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./migrations",
});
