import { ExtendedPostgresSaver } from "./checkpointer";
import { PostgresStore } from "./store";
import { createLogger } from "../logging/logger";
import { tApp } from "../i18n";
import { getPostgresPool, initializePostgres, closePostgres } from "./postgres";

const logger = createLogger("connection");

let checkpointer: ExtendedPostgresSaver | null = null;
let store: PostgresStore | null = null;
let connectionInitialized = false;

export async function initializeConnection(): Promise<void> {
  if (connectionInitialized) return;

  const pool = getPostgresPool();
  await initializePostgres();

  if (!checkpointer) {
    checkpointer = new ExtendedPostgresSaver(pool);
    await checkpointer.start();
    logger.debug(tApp("foundation.log.connection.checkpointerReady"));
  }

  if (!store) {
    store = new PostgresStore();
    await store.start();
    logger.info(tApp("foundation.log.connection.storeReady"));
  }

  connectionInitialized = true;
}

export async function closeConnection(): Promise<void> {
  if (store) {
    await store.stop();
    store = null;
  }

  if (checkpointer) {
    checkpointer = null;
  }

  await closePostgres();
}

export function getCheckpointer(): ExtendedPostgresSaver | null {
  return checkpointer;
}

export function getStore(): PostgresStore | null {
  return store;
}
