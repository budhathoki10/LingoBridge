import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { MongoClient } from "mongodb";
import { createMongoDatabase, type Database } from "./client.js";
import { runMigrations } from "./migrations.js";

export * from "./account.js";
export * from "./client.js";
export * from "./migrations.js";
export * from "./phrases.js";
export * from "./sessions.js";
export * from "./sync.js";
export * from "./users.js";

export const DEFAULT_DATABASE_NAME = "lingobridge";

/** Set by the test harness to share one embedded server across test files. */
export const TEST_MONGODB_URI_VARIABLE = "LINGOBRIDGE_TEST_MONGODB_URI";

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

export function isMongoConnectionString(value: string): boolean {
  return /^mongodb(\+srv)?:\/\//u.test(value);
}

export interface OpenDatabaseOptions {
  /** A MongoDB connection string. Required in production. */
  connectionString?: string;
  /** Defaults to `lingobridge`. */
  databaseName?: string;
  /** Directory for the embedded development database. Omit for an in-memory database. */
  embeddedDataDirectory?: string;
  production: boolean;
}

/**
 * The embedded server is a single-node replica set because multi-document transactions, which
 * account locking and sync depend on, are unavailable on a standalone MongoDB.
 */
async function startEmbeddedServer(dataDirectory?: string) {
  const { MongoMemoryReplSet } = await import("mongodb-memory-server-core");
  if (dataDirectory) await mkdir(dataDirectory, { recursive: true });
  return MongoMemoryReplSet.create({
    instanceOpts: dataDirectory ? [{ dbPath: dataDirectory, storageEngine: "wiredTiger" }] : [],
    replSet: { count: 1, storageEngine: "wiredTiger" },
  });
}

async function connect(
  uri: string,
  databaseName: string,
  onClose?: () => Promise<void>,
): Promise<Database> {
  const mongo = new MongoClient(uri, {
    appName: "lingobridge",
    maxPoolSize: 10,
    retryWrites: true,
  });
  await mongo.connect();
  const database = createMongoDatabase(mongo, databaseName, onClose);
  await runMigrations(database);
  return database;
}

/**
 * Production always uses a real MongoDB deployment with TLS left to the connection string. The
 * embedded server exists for local development and tests and is refused in production, so a
 * missing DATABASE_URL fails loudly instead of writing account data to a local disk.
 */
export async function openDatabase(options: OpenDatabaseOptions): Promise<Database> {
  const databaseName = options.databaseName ?? DEFAULT_DATABASE_NAME;
  if (options.connectionString) {
    if (!isMongoConnectionString(options.connectionString)) {
      throw new Error("DATABASE_URL must be a mongodb:// or mongodb+srv:// connection string.");
    }
    return connect(options.connectionString, databaseName);
  }
  if (options.production) throw new Error("DATABASE_URL is required in production.");

  const server = await startEmbeddedServer(options.embeddedDataDirectory);
  return connect(server.getUri(), databaseName, async () => {
    await server.stop();
  });
}

/**
 * A fresh, empty database. Under the test harness each call gets its own database name on the
 * shared server, and closing it drops that database.
 */
export async function openInMemoryDatabase(): Promise<Database> {
  const sharedUri = process.env[TEST_MONGODB_URI_VARIABLE];
  if (!sharedUri) return openDatabase({ production: false });

  const databaseName = `test_${randomUUID().replaceAll("-", "")}`;
  const database = await connect(sharedUri, databaseName);
  return {
    ...database,
    close: async () => {
      await database.db.dropDatabase().catch(() => undefined);
      await database.close();
    },
  };
}
