import type { PGlite } from "@electric-sql/pglite";
import type { Pool, PoolClient } from "pg";

/**
 * The smallest SQL surface the stores need. Production uses node-postgres against a managed
 * PostgreSQL database; local development and tests use PGlite, which is PostgreSQL itself compiled
 * to WebAssembly, so migrations and ownership queries are exercised against the real engine.
 */
export interface SqlClient {
  /** Runs one or more statements without parameters. Reserved for migrations. */
  exec(text: string): Promise<void>;
  query<Row = Record<string, unknown>>(
    text: string,
    params?: readonly unknown[],
  ): Promise<{ rows: Row[] }>;
}

export interface Database extends SqlClient {
  close(): Promise<void>;
  transaction<T>(work: (client: SqlClient) => Promise<T>): Promise<T>;
}

export function createPgliteDatabase(pglite: PGlite): Database {
  // PGlite runs one connection, so using the outer handle inside a transaction would deadlock.
  // Stores always use the client they are given.
  return {
    close: () => pglite.close(),
    exec: async (text) => {
      await pglite.exec(text);
    },
    query: async <Row>(text: string, params: readonly unknown[] = []) => {
      const result = await pglite.query<Row>(text, [...params]);
      return { rows: result.rows };
    },
    transaction: (work) =>
      pglite.transaction((transaction) =>
        work({
          exec: async (text) => {
            await transaction.exec(text);
          },
          query: async <Row>(text: string, params: readonly unknown[] = []) => {
            const result = await transaction.query<Row>(text, [...params]);
            return { rows: result.rows };
          },
        }),
      ),
  };
}

function wrapPoolClient(client: PoolClient): SqlClient {
  return {
    exec: async (text) => {
      await client.query(text);
    },
    query: async <Row>(text: string, params: readonly unknown[] = []) => {
      const result = await client.query(text, [...params]);
      return { rows: result.rows as Row[] };
    },
  };
}

export function createPgDatabase(pool: Pool): Database {
  return {
    close: () => pool.end(),
    exec: async (text) => {
      await pool.query(text);
    },
    query: async <Row>(text: string, params: readonly unknown[] = []) => {
      const result = await pool.query(text, [...params]);
      return { rows: result.rows as Row[] };
    },
    async transaction(work) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        const value = await work(wrapPoolClient(client));
        await client.query("commit");
        return value;
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
  };
}

/** PostgreSQL drivers disagree on timestamp and bigint representations; normalize at the edge. */
export function toIsoString(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return new Date(String(value)).toISOString();
}

export function toNullableIsoString(value: unknown): string | null {
  return value === null || value === undefined ? null : toIsoString(value);
}

export function toInteger(value: unknown): number {
  return typeof value === "number" ? value : Number(value);
}
