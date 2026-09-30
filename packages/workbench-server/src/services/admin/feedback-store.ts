import type {
  FeedbackSourceType,
  FeedbackRating,
  FeedbackRecord,
  FeedbackPage,
} from "@ontomato/contracts/feedback";
import { randomUUID } from "node:crypto";
import { getPostgresPool, qualifiedTable } from "../../infrastructure/postgres";

export interface SaveFeedbackInput {
  sourceType: FeedbackSourceType;
  targetId: string;
  threadId?: string;
  requestSeq?: number;
  taskId?: string;
  rating: FeedbackRating;
  userId: string;
  domainId?: string;
  userName?: string;
  userInput?: string;
  assistantOutput?: string;
  feedbackText?: string;
  metadata?: unknown;
}

export type FeedbackTargetInput = Pick<
  SaveFeedbackInput,
  "sourceType" | "targetId" | "threadId" | "requestSeq" | "taskId" | "metadata"
>;

export interface ListFeedbackOptions {
  sourceType?: FeedbackSourceType;
  rating?: FeedbackRating;
  domainId?: string;
  userId?: string;
  threadId?: string;
  taskId?: string;
  targetIds?: string[];
  keyword?: string;
  limit?: number;
  offset?: number;
}

function mapRow(row: any): FeedbackRecord {
  return {
    id: row.id,
    sourceType: row.source_type,
    targetId: row.target_id,
    threadId: row.thread_id || undefined,
    requestSeq: row.request_seq ?? undefined,
    taskId: row.task_id || undefined,
    rating: row.rating,
    userId: row.user_id,
    userName: row.user_name || undefined,
    userInput: row.user_input || undefined,
    assistantOutput: row.assistant_output || undefined,
    feedbackText: row.feedback_text || undefined,
    metadata: row.metadata ?? undefined,
    createdAt: Number(row.created_at),
  };
}

function sameFeedbackTargetWhere(input: FeedbackTargetInput, startIndex: number) {
  const values: unknown[] = [input.sourceType];
  const clauses: string[] = [];

  const metadata = input.metadata as { turnKey?: unknown } | null | undefined;
  const turnKey = typeof metadata?.turnKey === "string" ? metadata.turnKey.trim() : "";
  if (turnKey) {
    values.push(turnKey);
    clauses.push(`metadata->>'turnKey' = $${startIndex + values.length - 1}`);
    clauses.push(`target_id = $${startIndex + values.length - 1}`);
  }
  if (input.threadId && Number.isInteger(input.requestSeq)) {
    values.push(input.threadId, input.requestSeq);
    const threadParam = startIndex + values.length - 2;
    const seqParam = startIndex + values.length - 1;
    clauses.push(`(thread_id = $${threadParam} AND request_seq = $${seqParam})`);
  }
  if (input.taskId) {
    values.push(input.taskId);
    clauses.push(`task_id = $${startIndex + values.length - 1}`);
  }
  if (input.targetId) {
    values.push(input.targetId);
    clauses.push(`target_id = $${startIndex + values.length - 1}`);
  }

  return {
    values,
    where: `source_type = $${startIndex} AND (${clauses.join(" OR ")})`,
  };
}

export async function deleteFeedback(input: FeedbackTargetInput): Promise<number> {
  const pool = getPostgresPool();
  const target = sameFeedbackTargetWhere(input, 1);
  const result = await pool.query(
    `DELETE FROM ${qualifiedTable("feedback_records")} WHERE ${target.where}`,
    target.values
  );
  return result.rowCount || 0;
}

export async function saveFeedback(input: SaveFeedbackInput): Promise<FeedbackRecord> {
  const id = randomUUID();
  const createdAt = Date.now();
  const pool = getPostgresPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const duplicateTarget = sameFeedbackTargetWhere(input, 1);
    await client.query(
      `DELETE FROM ${qualifiedTable("feedback_records")} WHERE ${duplicateTarget.where}`,
      duplicateTarget.values
    );

    const result = await client.query(
      `INSERT INTO ${qualifiedTable("feedback_records")}
      (id, source_type, target_id, thread_id, request_seq, task_id, rating, user_id, domain_id,
       user_name, user_input, assistant_output, feedback_text, metadata, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
     RETURNING *`,
      [
        id,
        input.sourceType,
        input.targetId,
        input.threadId || null,
        Number.isInteger(input.requestSeq) ? input.requestSeq : null,
        input.taskId || null,
        input.rating,
        input.userId || "anonymous",
        input.domainId || null,
        input.userName || null,
        input.userInput || null,
        input.assistantOutput || null,
        input.feedbackText || null,
        input.metadata === undefined ? null : input.metadata,
        createdAt,
      ]
    );
    await client.query("COMMIT");
    return mapRow(result.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function dedupeFeedbackRecords(): Promise<number> {
  const pool = getPostgresPool();
  const result = await pool.query(
    `WITH ranked AS (
       SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY source_type,
             COALESCE(
               NULLIF(metadata->>'turnKey', ''),
               CASE
                 WHEN thread_id IS NOT NULL AND request_seq IS NOT NULL
                 THEN 'turn.' || thread_id || '.' || request_seq::text
               END,
               NULLIF(task_id, ''),
               target_id
             )
           ORDER BY created_at DESC, id DESC
         ) AS rn
       FROM ${qualifiedTable("feedback_records")}
     )
     DELETE FROM ${qualifiedTable("feedback_records")} f
     USING ranked r
     WHERE f.id = r.id AND r.rn > 1`
  );
  return result.rowCount || 0;
}

export async function listFeedback(options: ListFeedbackOptions = {}): Promise<FeedbackPage> {
  const where: string[] = [];
  const values: unknown[] = [];

  if (options.domainId) {
    values.push(options.domainId);
    where.push(`domain_id = $${values.length}`);
  }
  if (options.sourceType) {
    values.push(options.sourceType);
    where.push(`source_type = $${values.length}`);
  }
  if (options.rating) {
    values.push(options.rating);
    where.push(`rating = $${values.length}`);
  }
  if (options.userId) {
    values.push(options.userId);
    where.push(`user_id = $${values.length}`);
  }
  if (options.threadId) {
    values.push(options.threadId);
    where.push(`thread_id = $${values.length}`);
  }
  if (options.taskId) {
    values.push(options.taskId);
    where.push(`task_id = $${values.length}`);
  }
  if (options.targetIds?.length) {
    values.push(options.targetIds);
    where.push(`target_id = ANY($${values.length})`);
  }
  const keyword = String(options.keyword || "").trim();
  if (keyword) {
    values.push(`%${keyword}%`);
    const idx = values.length;
    where.push(
      `(user_id ILIKE $${idx} OR user_name ILIKE $${idx} OR user_input ILIKE $${idx} OR assistant_output ILIKE $${idx} OR feedback_text ILIKE $${idx})`
    );
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const limit = Math.max(1, Math.min(500, Number(options.limit || 20)));
  const offset = Math.max(0, Number(options.offset || 0));

  const pool = getPostgresPool();
  const countResult = await pool.query(
    `SELECT COUNT(*)::int AS total FROM ${qualifiedTable("feedback_records")} ${whereSql}`,
    values
  );
  const queryValues = [...values, limit, offset];
  const result = await pool.query(
    `SELECT * FROM ${qualifiedTable("feedback_records")}
     ${whereSql}
     ORDER BY created_at DESC
     LIMIT $${queryValues.length - 1} OFFSET $${queryValues.length}`,
    queryValues
  );

  return {
    records: result.rows.map(mapRow),
    total: Number(countResult.rows[0]?.total || 0),
    limit,
    offset,
  };
}
