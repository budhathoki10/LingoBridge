import { mkdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import pg from "pg";
import { createPgDatabase, createPgliteDatabase, type Database } from "./client.js";
import { runMigrations } from "./migrations.js";

export * from "./account.js";
export * from "./client.js";
export * from "./migrations.js";
export * from "./phrases.js";
export * from "./sessions.js";
export * from "./sync.js";
export * from "./users.js";

export interface DatabaseConfiguration {
  readonly connectionStringConfigured: boolean;
}

export function inspectDatabaseConfiguration(
  connectionString: string | undefined,
): DatabaseConfiguration {
  return {
    connectionStringConfigured: Boolean(connectionString),
  };
}

export interface OpenDatabaseOptions {
  /** A PostgreSQL connection string. Required in production. */
  connectionString?: string;
  /** Directory for the embedded development database. Omit for an in-memory database. */
  embeddedDataDirectory?: string;
  production: boolean;
}

/**
 * Production always uses a real PostgreSQL connection with TLS left to the connection string.
 * The embedded engine exists for local development and tests and is refused in production, so a
 * missing DATABASE_URL fails loudly instead of writing account data to a local disk.
 */
export async function openDatabase(options: OpenDatabaseOptions): Promise<Database> {
  let database: Database;
  if (options.connectionString) {
    database = createPgDatabase(
      new pg.Pool({ connectionString: options.connectionString, max: 10 }),
    );
  } else if (options.production) {
    throw new Error("DATABASE_URL is required in production.");
  } else {
    if (options.embeddedDataDirectory) {
      await mkdir(options.embeddedDataDirectory, { recursive: true });
    }
    database = createPgliteDatabase(
      options.embeddedDataDirectory ? new PGlite(options.embeddedDataDirectory) : new PGlite(),
    );
  }
  await runMigrations(database);
  return database;
}

export async function openInMemoryDatabase(): Promise<Database> {
  return openDatabase({ production: false });
}
