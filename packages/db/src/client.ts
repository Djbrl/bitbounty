import { drizzle } from "drizzle-orm/node-postgres";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import pg from "pg";
import * as schema from "./schema.js";

/** Any Drizzle Postgres database with our schema (node-postgres in the app, PGlite in tests). */
export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;

/** Connects to Postgres. Call `close()` when a script is done. */
export function createDb(url: string) {
  const pool = new pg.Pool({ connectionString: url });
  const db = drizzle(pool, { schema });
  return { db, close: () => pool.end() };
}

export function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (see .env.example)");
  return url;
}
