import { createHash } from "node:crypto";
import { qualifiedTable } from "../../postgres.js";
import type { QueryableClient } from "../helpers.js";

export const ABC_REFERENCE_STORAGE_VERSION = "20260724_abc_reference_storage_v1";
export const ABC_REFERENCE_STORAGE_NAME = "analysis ABC facts stored by query run reference";

const QUERY_FACT_FIELDS =
  "abcSubQuestions abcDsls abcCodes abcOutKeyRefs data datasets dataPreview datasetPreviews replayPlan dsl thinkingState cards winner backendNodeId sessionId".split(
    " "
  );

type BackfillKind = "payload_backfill" | "hot_card_backfill";
type JsonObject = Record<string, any>;

export type AbcReferenceStorageResult = { terminalSkips: string[] };

const jsonParam = (value: unknown) => (value === undefined ? null : JSON.stringify(value));

function queryRunId(threadId: string, requestSeq: number, sourceRef: string): string {
  const digest = createHash("md5").update(`${threadId}:${requestSeq}:${sourceRef}`).digest("hex");
  return `query:${digest}`;
}

async function findQueryRun(
  client: QueryableClient,
  question: JsonObject,
  owner: { threadId?: string; requestSeq?: number }
): Promise<JsonObject | undefined> {
  const ref = question.queryRunRef || {};
  const result = await client.query(
    `SELECT id, thread_id, request_seq, source_kind, source_ref FROM ${qualifiedTable("query_runs")}
     WHERE ($1::text IS NOT NULL AND id = $1)
        OR ($2::text IS NOT NULL AND thread_id = $2 AND request_seq = $3
            AND source_kind = $4 AND source_ref = $5)
        OR ($6::text IS NOT NULL AND thread_id = $6
            AND ($7::integer IS NULL OR request_seq = $7)
            AND source_kind = 'analysis_sub_question' AND source_ref = $8)
     ORDER BY CASE WHEN id = $1 THEN 0 ELSE 1 END, updated_at DESC
     LIMIT 1`,
    [
      ref.queryRunId || null,
      ref.threadId || null,
      Number.isInteger(ref.requestSeq) ? ref.requestSeq : null,
      ref.sourceKind || null,
      ref.sourceRef || null,
      owner.threadId || null,
      Number.isInteger(owner.requestSeq) ? owner.requestSeq : null,
      question.id,
    ]
  );
  return result.rows[0];
}

async function writeQueryRun(
  client: QueryableClient,
  question: JsonObject,
  owner: { id: string; threadId?: string; requestSeq?: number; kind: BackfillKind },
  existing?: JsonObject
): Promise<JsonObject> {
  if (existing) {
    return {
      queryRunId: existing.id,
      threadId: existing.thread_id,
      requestSeq: existing.request_seq,
      sourceKind: existing.source_kind,
      sourceRef: existing.source_ref,
    };
  }
  const ref = question.queryRunRef || {};
  const threadId = ref.threadId || owner.threadId || `${owner.kind}:${owner.id}`;
  const requestSeq = Number.isInteger(ref.requestSeq)
    ? ref.requestSeq
    : Number.isInteger(owner.requestSeq)
      ? owner.requestSeq
      : 0;
  const sourceKind = owner.kind;
  const sourceRef = `backfill:${owner.id}:${question.id}`;
  const id = queryRunId(threadId, requestSeq, sourceRef);
  const marker = { abcReferenceBackfillSource: owner.kind, ownerId: owner.id };
  const payload: JsonObject = { ...question, markdownTable: question.dataPreview };
  delete payload.dataPreview;
  delete payload.queryRunRef;

  await client.query(
    `INSERT INTO ${qualifiedTable("query_runs")}
      (id, thread_id, request_seq, source_kind, source_ref, source_stage, question, status, error,
       result_payload, data_payload, datasets_payload, dsl_payload, data_count, abc_sub_questions,
       abc_dsls, abc_codes, abc_out_key_refs, replay_plan, thinking_state, legacy_payload,
       created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,'abc_reference_migration',$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,
             $16,$17,$18,$19,$20,NOW(),NOW())
     ON CONFLICT (id) DO NOTHING`,
    [
      id,
      threadId,
      requestSeq,
      sourceKind,
      sourceRef,
      question.subQuestion || question.text || null,
      question.status || "completed",
      question.status === "failed" ? question.statusText || null : null,
      jsonParam(payload),
      jsonParam(question.data),
      jsonParam(question.datasets),
      jsonParam(question.dsl),
      question.dataCount ?? null,
      jsonParam(question.abcSubQuestions),
      jsonParam(question.abcDsls),
      jsonParam(question.abcCodes),
      jsonParam(question.abcOutKeyRefs),
      jsonParam(question.replayPlan),
      jsonParam(question.thinkingState),
      JSON.stringify(marker),
    ]
  );
  return { queryRunId: id, threadId, requestSeq, sourceKind, sourceRef };
}

async function migrateDimensions(
  client: QueryableClient,
  dimensions: JsonObject[],
  owner: { id: string; threadId?: string; requestSeq?: number; kind: BackfillKind },
  terminalSkips: string[]
): Promise<boolean> {
  let changed = false;
  for (const [dimensionIndex, dimension] of dimensions.entries()) {
    const subQuestions = Array.isArray(dimension?.subQuestions) ? dimension.subQuestions : [];
    for (const [questionIndex, question] of subQuestions.entries()) {
      if (!question || !QUERY_FACT_FIELDS.some((field) => question[field] !== undefined)) continue;
      if (!String(question.id || "").trim()) {
        terminalSkips.push(
          `${owner.kind}:${owner.id}:dimensions[${dimensionIndex}].subQuestions[${questionIndex}]:sub-question has no stable id`
        );
        continue;
      }
      question.queryRunRef = await writeQueryRun(
        client,
        question,
        owner,
        await findQueryRun(client, question, owner)
      );
      for (const field of QUERY_FACT_FIELDS) delete question[field];
      changed = true;
    }
  }
  return changed;
}

export async function migrateAbcReferenceStorage(
  client: QueryableClient
): Promise<AbcReferenceStorageResult> {
  const result: AbcReferenceStorageResult = { terminalSkips: [] };
  const sources = [
    {
      kind: "payload_backfill" as const,
      table: qualifiedTable("analysis_tasks"),
      field: "analysis_payload",
      select: `SELECT id, thread_id, analysis_payload->>'requestSeq' AS request_seq, analysis_payload AS document
               FROM ${qualifiedTable("analysis_tasks")} WHERE analysis_payload IS NOT NULL`,
    },
    {
      kind: "hot_card_backfill" as const,
      table: qualifiedTable("analysis_report_hot_cards"),
      field: "dimensions",
      select: `SELECT id, session_id AS thread_id, NULL::text AS request_seq, dimensions AS document
               FROM ${qualifiedTable("analysis_report_hot_cards")} WHERE dimensions IS NOT NULL`,
    },
  ];

  for (const source of sources) {
    let afterId: string | null = null;
    while (true) {
      const rows = await client.query(
        `${source.select} AND ($1::text IS NULL OR id > $1) ORDER BY id LIMIT 1`,
        [afterId]
      );
      if (rows.rows.length === 0) break;
      const row: JsonObject = rows.rows[0];
      afterId = String(row.id);
      const document = row.document;
      const dimensions =
        source.kind === "payload_backfill" ? document?.plannedDimensions : document;
      if (!Array.isArray(dimensions)) continue;
      const changed = await migrateDimensions(
        client,
        dimensions,
        {
          id: String(row.id),
          threadId: row.thread_id || undefined,
          requestSeq: /^\d+$/.test(String(row.request_seq || ""))
            ? Number(row.request_seq)
            : undefined,
          kind: source.kind,
        },
        result.terminalSkips
      );
      if (changed) {
        if (source.kind === "payload_backfill") {
          document.evidenceRefs = dimensions.flatMap((dimension: JsonObject) =>
            (Array.isArray(dimension?.subQuestions) ? dimension.subQuestions : [])
              .map((question: JsonObject) => question?.queryRunRef)
              .filter(Boolean)
          );
        }
        await client.query(`UPDATE ${source.table} SET ${source.field} = $2::jsonb WHERE id = $1`, [
          row.id,
          JSON.stringify(document),
        ]);
      }
    }
  }
  return result;
}
