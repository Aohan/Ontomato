import pg from "pg";
import { harnessSessions } from "./harness-sessions";
import { environment } from "../config/environment";
import { createLogger } from "../logging/logger";
import { tApp } from "../i18n";
import { runPostgresBusinessMigrations } from "./postgres-migrations/index.js";

const { Pool } = pg;
const logger = createLogger("postgres");

let pool: pg.Pool | null = null;
let schemaName: string;

export function getSchemaName(): string {
  return environment.pgSchema();
}

export function getPostgresPool(): pg.Pool {
  if (!pool) {
    schemaName = getSchemaName();
    pool = new Pool({
      connectionString: environment.pgConnection(),
      max: 20,
      idleTimeoutMillis: 30000,
    });
    pool.on("error", (err) => {
      logger.error(tApp("foundation.log.pg.poolError"), err);
    });
    logger.info(tApp("foundation.log.pg.poolCreated"));
  }
  return pool;
}

export async function initializePostgres(): Promise<void> {
  const p = getPostgresPool();
  const client = await p.connect();
  try {
    if (schemaName !== "public") {
      await client.query(`CREATE SCHEMA IF NOT EXISTS ${escapeIdentifier(schemaName)}`);
    }

    await runPostgresBusinessMigrations(client);
    await harnessSessions.recoverAllInterrupted();

    logger.info(tApp("foundation.log.pg.schemaReady"));
  } finally {
    client.release();
  }
}

export function qualifiedTable(table: string): string {
  const schema = schemaName || getSchemaName();
  if (schema === "public") return escapeIdentifier(table);
  return `${escapeIdentifier(schema)}.${escapeIdentifier(table)}`;
}

function escapeIdentifier(id: string): string {
  return `"${id.replace(/"/g, '""')}"`;
}

export async function closePostgres(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    logger.info(tApp("foundation.log.pg.poolClosed"));
  }
}
