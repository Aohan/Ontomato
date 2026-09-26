import {
  syncAnalysisTaskArtifacts,
  type AnalysisTaskArtifactSyncResult,
} from "./analysis-task-snapshots.js";
import { copyLegacyChatRenderSnapshots } from "./chat-render-snapshots.js";
import { copyLegacyExecutionEvents } from "./execution-events.js";
import { copyLegacyQueryRuns } from "./query-runs.js";
import { qualifiedTable } from "../../postgres.js";
import type { QueryableClient } from "../helpers.js";

export const BUSINESS_STORAGE_V1_VERSION = "20260625_business_storage_v1";
export const BUSINESS_STORAGE_V1_NAME = "business storage query-run snapshots events v1";

export interface BusinessStorageV1CopyResult {
  queryRuns: number;
  chatRenderSnapshots: number;
  executionEvents: number;
  syncedThreadSequences: number;
  analysisTaskArtifacts: AnalysisTaskArtifactSyncResult;
}

export async function migrateBusinessStorageV1(
  client: QueryableClient
): Promise<BusinessStorageV1CopyResult> {
  const copiedQueryRuns = await copyLegacyQueryRuns(client);
  const copiedSnapshots = await copyLegacyChatRenderSnapshots(client);
  const copiedEvents = await copyLegacyExecutionEvents(client);
  const syncedThreadSequences = await syncThreadMetadataLastRequestSeq(client);
  const analysisTaskArtifacts = await syncAnalysisTaskArtifacts(client);

  return {
    queryRuns: copiedQueryRuns,
    chatRenderSnapshots: copiedSnapshots,
    executionEvents: copiedEvents,
    syncedThreadSequences,
    analysisTaskArtifacts,
  };
}

/**
 * 只同步已存在 thread_metadata 行的会话：源查询事实可能没有对应会话
 * （ABC 回填的合成 threadId、其他业务来源），此处不插入元数据、不编造身份，
 * 也不改动这些来源的查询事实。
 */
export async function syncThreadMetadataLastRequestSeq(client: QueryableClient): Promise<number> {
  const result = await client.query(`
    WITH request_sequences AS (
      SELECT thread_id, request_seq FROM ${qualifiedTable("query_runs")}
      UNION ALL
      SELECT thread_id, request_seq FROM ${qualifiedTable("chat_render_snapshots")}
      UNION ALL
      SELECT thread_id, request_seq FROM ${qualifiedTable("execution_events")}
    ),
    max_sequences AS (
      SELECT thread_id, MAX(request_seq)::integer AS last_request_seq
      FROM request_sequences
      GROUP BY thread_id
    )
    UPDATE ${qualifiedTable("thread_metadata")} AS metadata
    SET
      last_request_seq = GREATEST(
        COALESCE(metadata.last_request_seq, -1),
        sequences.last_request_seq
      ),
      updated_at = COALESCE(metadata.updated_at, NOW())
    FROM max_sequences AS sequences
    WHERE metadata.thread_id = sequences.thread_id
  `);
  return result.rowCount ?? 0;
}
