import { qualifiedTable } from "../../postgres.js";
import type { QueryableClient } from "../helpers.js";

/**
 * Single storage template for query facts: facts that previously could only be crammed into the mixed JSON column get their own structured columns.
 * Like the other schema steps it uses idempotent DDL: an empty database gets everything in one pass, existing databases converge by missing columns.
 * The mixed column `result_payload` is still created by business-storage-v1's table creation — legacy carries from earlier versions must write it;
 * the migration in this directory DROPs the column after carrying completes, leaving both database kinds at the same end state.
 */
export async function ensureQueryFactStorageTemplate(client: QueryableClient): Promise<void> {
  for (const column of [
    "node_ids JSONB",
    "markdown_table TEXT",
    "dataset_previews JSONB",
    "cards JSONB",
    "winner TEXT",
  ]) {
    await client.query(
      `ALTER TABLE ${qualifiedTable("query_runs")} ADD COLUMN IF NOT EXISTS ${column}`
    );
  }
}
