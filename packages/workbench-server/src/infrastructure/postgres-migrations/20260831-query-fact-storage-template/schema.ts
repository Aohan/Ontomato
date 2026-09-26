import { qualifiedTable } from "../../postgres.js";
import type { QueryableClient } from "../helpers.js";

/**
 * 查询事实唯一存储模板：此前只能塞进混装 JSON 列的事实获得自己的结构化列。
 * 与其他 schema 步骤一致采用幂等 DDL：空库一次到位，存量库按缺列收敛。
 * 混装列 `result_payload` 仍由 business-storage-v1 建表创建——更早版本的存量搬运要写它；
 * 同目录迁移在搬运完成后 DROP 该列，两种库的终态一致。
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
