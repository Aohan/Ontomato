import { getPostgresPool, qualifiedTable } from "../../infrastructure/postgres";
import { deleteThreadQueryRuns } from "../data-query/query-run-store";
import { deleteThreadTurnRuns, startStandardTurnRun } from "../turn-run/turn-run-store";
import { deleteThreadChatRenderSnapshots } from "./chat-snapshot-store";
import { deleteThreadExecutionEvents } from "./execution-event-store";
import { HttpError } from "../../utils/errors";

export async function createThreadPlaceholder(
  threadId: string,
  title: string,
  userId: string,
  domainId: string,
  threadType?: string
): Promise<void> {
  const type = threadId.startsWith("task-") ? "task" : threadType || "qa";
  const result = await getPostgresPool().query(
    `INSERT INTO ${qualifiedTable("thread_metadata")}
        (thread_id, title, user_id, domain_id, thread_type, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
       ON CONFLICT (thread_id) DO UPDATE SET thread_id = EXCLUDED.thread_id
       WHERE ${qualifiedTable("thread_metadata")}.user_id = EXCLUDED.user_id
         AND ${qualifiedTable("thread_metadata")}.domain_id = EXCLUDED.domain_id
       RETURNING thread_id`,
    [threadId, title, userId, domainId, type]
  );
  if (!result.rows.length) throw new HttpError(403, "Thread access denied");
}

export async function allocateRequestSeq(threadId: string): Promise<number> {
  const result = await getPostgresPool().query(
    `UPDATE ${qualifiedTable("thread_metadata")}
       SET last_request_seq = last_request_seq + 1, updated_at = NOW()
       WHERE thread_id = $1
       RETURNING last_request_seq`,
    [threadId]
  );
  if (!result.rows.length) throw new Error("Thread metadata not found");
  return Number(result.rows[0].last_request_seq);
}

export async function updateThreadTitle(
  threadId: string,
  title: string,
  userId: string,
  domainId: string,
  options: { lockTitle?: boolean } = {}
): Promise<boolean> {
  const lockTitle = options.lockTitle === true;
  const result = await getPostgresPool().query(
    `UPDATE ${qualifiedTable("thread_metadata")} SET
         title = $2,
         title_locked = ${lockTitle ? "true" : `${qualifiedTable("thread_metadata")}.title_locked`},
         updated_at = NOW()
       WHERE thread_id = $1 AND user_id = $3 AND domain_id = $5
         AND ($4 OR NOT title_locked)`,
    [threadId, title, userId, lockTitle, domainId]
  );
  return (result.rowCount ?? 0) > 0;
}

export const startStandardTurn = (input: Parameters<typeof startStandardTurnRun>[0]) =>
  startStandardTurnRun(input);

export async function deleteThreadBusinessData(threadId: string): Promise<void> {
  await deleteThreadTurnRuns(threadId);
  await deleteThreadExecutionEvents(threadId);
  await deleteThreadChatRenderSnapshots(threadId);
  await deleteThreadQueryRuns(threadId);
}

export async function deleteThreadMetadata(threadId: string): Promise<void> {
  await getPostgresPool().query(
    `DELETE FROM ${qualifiedTable("thread_metadata")} WHERE thread_id = $1`,
    [threadId]
  );
}
