import { harnessSessions } from "../../../infrastructure/harness-sessions";
import type { AnalysisLoopSubagentAudit, AnalysisLoopSubagentReference } from "../task-types";
import type { AnalysisTaskPage } from "@ontomato/contracts/analysis-task";
export interface AnalysisTaskListPage extends Omit<AnalysisTaskPage, "tasks"> {
  tasks: AnalysisTask[];
}
import type { AnalysisTaskCounts } from "@ontomato/contracts/analysis-task";
import type {
  AnalysisTaskRun,
  AnalysisTaskStatus,
  AnalysisTaskTriggerSource,
} from "@ontomato/contracts/analysis-task";
/**
 * Storage of analysis task rows: one row per report run.
 *
 * Report artifacts persist only into `analysis_payload` (`result_summary` is the list page's lightweight preview);
 * the deliverable body is derived at read time by task-result. Schedule rules are not in this table — schedule-rules owns them.
 * The existing task list endpoints keep showing report tasks and schedule rules together; merging happens in this module's list read model.
 */

import pg from "pg";
import { v4 as uuidv4 } from "uuid";
import { createLogger } from "../../../logging/logger";
import { getPostgresPool, qualifiedTable } from "../../../infrastructure/postgres";
import { scheduleRuleTaskFeedSql } from "./schedule-rules";
import { buildDeepAnalysisTaskResult, buildDeepAnalysisTaskSnapshot } from "./task-result";
import type {
  AnalysisTask,
  CreateAnalysisTaskParams,
  UpsertAnalysisTaskEventInput,
} from "../task-types";
import type { DeepAnalysisTaskPayload } from "@ontomato/contracts/analysis-presentation";
import { createThreadPlaceholder } from "../../chat/thread-store";
import type { AnalysisConversationTurnRecord } from "./conversation-types";
import {
  isCurrentAnalysisRun,
  planAnalysisRunUpdate,
  readAnalysisRunHistory,
  type AnalysisRunIdentity,
} from "./run-history";
import { isAnalysisTaskTerminalStatus } from "./events";
import { PERSISTED_RESULT_KEYS } from "../../data-query/query-fact";
import type { AnalysisEvidenceQuestion } from "@ontomato/contracts/analysis-presentation";
import { tApp } from "../../../i18n";


const logger = createLogger("analysis-task-service");

interface AnalysisTaskRow {
  id: string;
  agent_id: string;
  user_id: string;
  domain_id: string;
  name: string;
  description: string | null;
  status: string;
  thread_id: string | null;
  question: string | null;
  schedule_expression?: string | null;
  schedule_enabled?: boolean;
  notify_email: string | null;
  notify_on_complete: boolean;
  result_summary: string | null;
  analysis_payload: DeepAnalysisTaskPayload | null;
  request_seq?: number | null;
  run_state?: DeepAnalysisTaskPayload["runState"];
  execution_mode?: DeepAnalysisTaskPayload["executionMode"];
  trigger_source: string | null;
  token: string | null;
  last_run_at: string | null;
  next_run_at?: string | null;
  created_at: string;
  updated_at: string;
  report_deliverable_enabled?: boolean;
  run_history?: unknown;
  harness_session_id?: string | null;
}

export interface ListTaskSummariesOptions {
  agentId?: string;
  userId: string;
  domainId: string;
  reportDeliverableEnabled?: boolean;
  limit?: number;
  offset?: number;
}

/** Projects task rows in list read-model order; column order matches `scheduleRuleTaskFeedSql()`. */
const TASK_FEED_SQL = `SELECT
  id,
  agent_id,
  user_id,
  domain_id,
  name,
  description,
  status,
  thread_id,
  question,
  NULL::text AS schedule_expression,
  false AS schedule_enabled,
  notify_email,
  notify_on_complete,
  result_summary,
  NULL::jsonb AS analysis_payload,
  trigger_source,
  NULL::text AS token,
  last_run_at,
  NULL::bigint AS next_run_at,
  created_at,
  updated_at,
  analysis_payload->'runState' AS run_state,
  analysis_payload->>'executionMode' AS execution_mode,
  report_deliverable_enabled
FROM `;

function taskListFeedSql(): string {
  return `${TASK_FEED_SQL}${qualifiedTable("analysis_tasks")}
    UNION ALL
    ${scheduleRuleTaskFeedSql()}`;
}

/** Plain task-row columns; the two large JSONB columns are projected per read. */
const TASK_COLUMNS = `id, agent_id, user_id, domain_id, name, description, status, thread_id, question,
  notify_email, notify_on_complete, result_summary, trigger_source, token, last_run_at,
  created_at, updated_at, report_deliverable_enabled, request_seq, harness_session_id`;

const RESULT_KEYS_SQL = `ARRAY[${PERSISTED_RESULT_KEYS.map((key) => `'${key}'`).join(", ")}]`;

/**
 * Stored activities with the persisted result copies dropped from each question execution and the
 * question marked deferred; the same rule as withoutPersistedResult, applied inside PostgreSQL so a
 * large stored payload never reaches Node.
 */
function deferredActivitiesSql(activities: string): string {
  return `(SELECT COALESCE(jsonb_agg(
      CASE WHEN jsonb_typeof(activity->'questions') = 'array'
        THEN jsonb_set(activity, '{questions}', (
          SELECT COALESCE(jsonb_agg(
            CASE WHEN question->'execution' ?| ${RESULT_KEYS_SQL}
              THEN jsonb_set(question, '{execution}', (question->'execution') - ${RESULT_KEYS_SQL})
                || '{"executionDeferred": true}'::jsonb
              ELSE question END
            ORDER BY question_position), '[]'::jsonb)
          FROM jsonb_array_elements(activity->'questions')
            WITH ORDINALITY AS question_items(question, question_position)))
        ELSE activity END
      ORDER BY activity_position), '[]'::jsonb)
    FROM jsonb_array_elements(${activities}) WITH ORDINALITY AS activity_items(activity, activity_position))`;
}

/** Run records reduced to identity and status: what run attribution checks need. */
const RUN_META_SQL = `(SELECT COALESCE(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'id', run->'id', 'requestSeq', run->'requestSeq', 'status', run->'status')) ORDER BY position), '[]'::jsonb)
  FROM jsonb_array_elements(run_history) WITH ORDINALITY AS runs(run, position))`;

export interface TaskReadScope {
  /**
   * none: row metadata; state: plus run state and execution mode; report: artifacts without activities
   * (body, charts, final answer); light: artifacts with deferred query results; full: the stored payload.
   */
  payload: "none" | "state" | "report" | "light" | "full";
  /** meta: run identity and status; summary: run records without replay snapshots. */
  runs: "none" | "meta" | "summary";
}

const PAYLOAD_SQL: Record<TaskReadScope["payload"], string> = {
  none: "NULL::jsonb AS analysis_payload",
  state: `NULL::jsonb AS analysis_payload, analysis_payload->'runState' AS run_state,
    analysis_payload->>'executionMode' AS execution_mode`,
  report: "jsonb_set(analysis_payload, '{activities}', '[]'::jsonb) AS analysis_payload",
  light: `jsonb_set(analysis_payload, '{activities}',
    ${deferredActivitiesSql("analysis_payload->'activities'")}) AS analysis_payload`,
  full: "analysis_payload",
};

const RUNS_SQL: Record<TaskReadScope["runs"], string> = {
  none: "NULL::jsonb AS run_history",
  meta: `${RUN_META_SQL} AS run_history`,
  summary: `(SELECT COALESCE(jsonb_agg(run - 'snapshot' ORDER BY position), '[]'::jsonb)
    FROM jsonb_array_elements(run_history) WITH ORDINALITY AS runs(run, position)) AS run_history`,
};

function mapTaskRow(row: AnalysisTaskRow): AnalysisTask {
  const analysisPayload = row.analysis_payload || undefined;
  return {
    id: row.id,
    agentId: row.agent_id,
    userId: row.user_id,
    domainId: row.domain_id,
    name: row.name,
    description: row.description || "",
    status: row.status as AnalysisTaskStatus,
    reportDeliverableEnabled: row.report_deliverable_enabled !== false,
    threadId: row.thread_id || undefined,
    question: row.question || undefined,
    scheduleExpression: row.schedule_expression || undefined,
    scheduleEnabled: row.schedule_enabled ?? false,
    notifyEmail: row.notify_email || undefined,
    notifyOnComplete: row.notify_on_complete,
    resultSummary: row.result_summary || undefined,
    // The report body is no longer stored in its own column; it is derived on demand from the single authoritative artifact.
    resultReport: buildDeepAnalysisTaskResult(analysisPayload).resultReport || undefined,
    analysisPayload,
    requestSeq: row.request_seq ?? undefined,
    runState: analysisPayload?.runState || row.run_state,
    executionMode: analysisPayload?.executionMode || row.execution_mode,
    triggerSource: (row.trigger_source || "manual") as AnalysisTaskTriggerSource,
    token: row.token || undefined,
    lastRunAt: row.last_run_at ? parseInt(row.last_run_at, 10) : undefined,
    nextRunAt: row.next_run_at ? parseInt(row.next_run_at, 10) : undefined,
    createdAt: parseInt(row.created_at, 10),
    updatedAt: parseInt(row.updated_at, 10),
    runHistory: Array.isArray(row.run_history)
      ? (row.run_history as AnalysisTask["runHistory"])
      : [],
  };
}

export class AnalysisTaskService {
  private pool: pg.Pool;

  constructor() {
    this.pool = getPostgresPool();
  }

  /** All turn facts of a regular session, returned in acceptance order; later turns never overwrite earlier ones. */
  async listConversationTurns(taskId: string): Promise<AnalysisConversationTurnRecord[]> {
    const result = await this.pool.query(
      `SELECT request_seq AS "requestSeq", user_message AS "userMessage", status,
        harness_turn_id AS "harnessTurnId", ${deferredActivitiesSql("activities")} AS activities,
        evidence_refs AS "evidenceRefs",
        summary_charts AS "charts", chart_diagnostics AS "chartDiagnostics",
        final_answer AS "finalAnswer", error, created_at AS "createdAt", updated_at AS "updatedAt"
       FROM ${qualifiedTable("analysis_task_turns")} WHERE task_id = $1 ORDER BY request_seq`,
      [taskId]
    );
    return Promise.all(
      result.rows.map(
        async (row): Promise<AnalysisConversationTurnRecord> => ({
          requestSeq: Number(row.requestSeq),
          userMessage: row.userMessage,
          status: row.status,
          harnessTurnId: row.harnessTurnId ?? undefined,
          messages: row.harnessTurnId ? await this.readHarnessTurnMessages(row.harnessTurnId) : [],
          activities: row.activities || [],
          evidenceRefs: row.evidenceRefs || [],
          charts: row.charts || [],
          chartDiagnostics: row.chartDiagnostics || [],
          finalAnswer: row.finalAnswer ?? undefined,
          error: row.error ?? undefined,
          createdAt: Number(row.createdAt),
          updatedAt: Number(row.updatedAt),
        })
      )
    );
  }

  /**
   * Accepts one regular-session turn: inside one transaction it occupies a non-running regular-session task, assigns the acceptance sequence, and writes the turn.
   * Returns null when the task is running or not a regular session, and the entry answers 409; the acceptance sequence and the task occupation share one transaction.
   */
  async claimConversationTurn(
    taskId: string,
    userMessage: string
  ): Promise<AnalysisConversationTurnRecord | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const now = Date.now();
      const claimed = await client.query(
        `UPDATE ${qualifiedTable("analysis_tasks")}
           SET status = 'running', updated_at = $2, last_run_at = $2, result_summary = NULL,
               analysis_payload = NULL, request_seq = NULL
         WHERE id = $1 AND status <> 'running' AND report_deliverable_enabled = FALSE
         RETURNING thread_id`,
        [taskId, now]
      );
      if (!claimed.rows.length) {
        await client.query("ROLLBACK");
        return null;
      }
      const seq = await client.query(
        `UPDATE ${qualifiedTable("thread_metadata")}
           SET last_request_seq = last_request_seq + 1, updated_at = NOW()
           WHERE thread_id = $1 RETURNING last_request_seq`,
        [claimed.rows[0].thread_id]
      );
      if (!seq.rows.length) throw new Error("Thread metadata not found");
      const turn: AnalysisConversationTurnRecord = {
        requestSeq: Number(seq.rows[0].last_request_seq),
        userMessage,
        status: "running",
        messages: [],
        activities: [],
        evidenceRefs: [],
        charts: [],
        chartDiagnostics: [],
        createdAt: now,
        updatedAt: now,
      };
      await client.query(
        `INSERT INTO ${qualifiedTable("analysis_task_turns")}
          (task_id, request_seq, user_message, status, created_at, updated_at)
         VALUES ($1, $2, $3, 'running', $4, $4)`,
        [taskId, turn.requestSeq, userMessage, now]
      );
      const run = JSON.stringify({
        id: `${taskId}:${uuidv4()}`,
        status: "running",
        requestSeq: turn.requestSeq,
        startedAt: now,
        createdAt: now,
      });
      await client.query(
        `UPDATE ${qualifiedTable("analysis_tasks")}
           SET run_history = COALESCE(run_history, '[]'::jsonb) || jsonb_build_array($2::jsonb),
               request_seq = $3
           WHERE id = $1`,
        [taskId, run, turn.requestSeq]
      );
      await client.query("COMMIT");
      return turn;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  /** Updates only the turn still running, so late intermediate writes can never overwrite a terminal state. */
  async saveConversationTurn(taskId: string, turn: AnalysisConversationTurnRecord): Promise<void> {
    const result = await this.pool.query(
      `UPDATE ${qualifiedTable("analysis_task_turns")} SET status = $3,
        activities = $4::jsonb, evidence_refs = $5::jsonb,
        final_answer = $6, error = $7, updated_at = $8,
        summary_charts = $9::jsonb, chart_diagnostics = $10::jsonb
       WHERE task_id = $1 AND request_seq = $2 AND status = 'running'`,
      [
        taskId,
        turn.requestSeq,
        turn.status,
        JSON.stringify(turn.activities),
        JSON.stringify(turn.evidenceRefs),
        turn.finalAnswer || null,
        turn.error || null,
        Date.now(),
        JSON.stringify(turn.charts),
        JSON.stringify(turn.chartDiagnostics),
      ]
    );
    if (result.rowCount !== 1) throw new Error("Conversation turn is no longer running");
  }

  private async readHarnessTurnMessages(turnId: string) {
    const found = await this.pool.query(
      `SELECT session_id FROM ${qualifiedTable("harness_turns")} WHERE id = $1`,
      [turnId]
    );
    if (!found.rows[0]) return [];
    return (await harnessSessions.listMessages(found.rows[0].session_id, turnId)).map(
      (row) => row.message
    );
  }

  async openHarnessSession(
    taskId: string,
    continuous: boolean,
    identity: AnalysisRunIdentity
  ): Promise<string> {
    const current = await this.pool.query(
      `SELECT harness_session_id, ${RUN_META_SQL} AS run_history
       FROM ${qualifiedTable("analysis_tasks")} WHERE id = $1`,
      [taskId]
    );
    const row = current.rows[0];
    if (!row || !isCurrentAnalysisRun(readAnalysisRunHistory(row.run_history), identity))
      throw new Error("Analysis run is no longer current");
    if (continuous && row.harness_session_id) return row.harness_session_id as string;
    const sessionId = uuidv4();
    await harnessSessions.create(sessionId);
    try {
      const updated = await this.applyTaskUpdateWithRunIdentity(
        taskId,
        ["harness_session_id = $2"],
        [sessionId],
        identity,
        { harnessSessionId: sessionId }
      );
      if (!updated || !isCurrentAnalysisRun(updated.runHistory || [], identity))
        throw new Error("Analysis run is no longer current");
      return sessionId;
    } catch (error) {
      await harnessSessions.deleteSession(sessionId);
      throw error;
    }
  }

  async bindHarnessTurn(taskId: string, requestSeq: number, turnId: string): Promise<void> {
    const result = await this.pool.query(
      `UPDATE ${qualifiedTable("analysis_task_turns")} SET harness_turn_id = $3
      WHERE task_id = $1 AND request_seq = $2 AND status = 'running'`,
      [taskId, requestSeq, turnId]
    );
    if (result.rowCount !== 1) throw new Error("Conversation turn is no longer running");
  }

  async getSubagentAudit(
    taskId: string,
    activityId: string
  ): Promise<AnalysisLoopSubagentAudit | null> {
    const ref = await this.getTaskEventPayload<AnalysisLoopSubagentReference>(
      taskId,
      "analysis_loop_subagent",
      activityId
    );
    if (!ref) return null;
    const turn = await harnessSessions.latestTurn(ref.sessionId);
    if (!turn) return null;
    return {
      activityId: ref.activityId,
      topic: ref.topic,
      status: turn.status === "interrupted" ? "failed" : turn.status,
      messages: (await harnessSessions.listMessages(ref.sessionId)).map((row) => row.message),
      ...(ref.error
        ? { error: ref.error }
        : turn.status === "interrupted"
          ? { error: "Subagent execution interrupted" }
          : {}),
    };
  }

  async listTaskSummaries(options: ListTaskSummariesOptions): Promise<AnalysisTaskListPage> {
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
    const offset = Math.max(options.offset ?? 0, 0);
    const where: string[] = ["user_id = $1", "domain_id = $2"];
    const params: any[] = [options.userId, options.domainId];

    if (options.agentId) {
      params.push(options.agentId);
      where.push(`agent_id = $${params.length}`);
    }
    if (options.reportDeliverableEnabled !== undefined) {
      params.push(options.reportDeliverableEnabled);
      where.push(`report_deliverable_enabled = $${params.length}`);
    }

    const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const countResult = await this.pool.query(
      `SELECT COUNT(*)::int AS total
       FROM (${taskListFeedSql()}) AS task_feed
       ${whereClause}`,
      params
    );
    const total = Number(countResult.rows[0]?.total || 0);

    const limitIdx = params.length + 1;
    const offsetIdx = params.length + 2;
    const pageParams = [...params, limit, offset];
    const result = await this.pool.query(
      `SELECT * FROM (${taskListFeedSql()}) AS task_feed
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      pageParams
    );

    return {
      tasks: result.rows.map(mapTaskRow),
      total,
      limit,
      offset,
    };
  }

  /** Reads one task with only the parts of its large columns that the caller's use needs. */
  async getTask(id: string, domainId: string, scope: TaskReadScope): Promise<AnalysisTask | null> {
    const result = await this.pool.query(
      `SELECT ${TASK_COLUMNS}, ${PAYLOAD_SQL[scope.payload]}, ${RUNS_SQL[scope.runs]}
       FROM ${qualifiedTable("analysis_tasks")} WHERE id = $1 AND domain_id = $2`,
      [id, domainId]
    );
    return result.rows.length > 0 ? mapTaskRow(result.rows[0]) : null;
  }

  /**
   * One run's replay snapshot with deferred query results. Undefined when the run does not exist;
   * null when that legacy run saved no snapshot.
   */
  async getRunSnapshot(taskId: string, runId: string): Promise<unknown> {
    const result = await this.pool.query(
      `SELECT jsonb_set(run->'snapshot', '{deepAnalysis,activities}',
         ${deferredActivitiesSql("run->'snapshot'->'deepAnalysis'->'activities'")}) AS snapshot
       FROM ${qualifiedTable("analysis_tasks")} AS task,
         jsonb_array_elements(task.run_history) AS runs(run)
       WHERE task.id = $1 AND run->>'id' = $2`,
      [taskId, runId]
    );
    return result.rows.length > 0 ? result.rows[0].snapshot : undefined;
  }

  /**
   * A question as its run stored it, with the acceptance sequence its query run is keyed by: a
   * historical report run (runId), a regular-session turn (requestSeq), or the current report run.
   * `light` leaves stored result copies in PostgreSQL (the query run is authoritative when it exists);
   * `full` returns the stored execution, read only when that query run is missing.
   * Null when that run or turn does not exist.
   */
  async getStoredQuestion(
    taskId: string,
    questionId: string,
    at: { runId?: string; requestSeq?: number },
    part: "light" | "full"
  ): Promise<{ requestSeq?: number; question?: AnalysisEvidenceQuestion } | null> {
    const found = (document: string, path: string) =>
      `LATERAL (SELECT jsonb_path_query_first(${document},
        '${path}.questions[*] ? (@.questionId == $id)', jsonb_build_object('id', $2::text)) AS q) AS found`;
    const question =
      part === "full"
        ? "found.q"
        : `CASE WHEN found.q ? 'execution'
            THEN jsonb_set(found.q, '{execution}', (found.q->'execution') - ${RESULT_KEYS_SQL})
            ELSE found.q END`;
    const result =
      at.runId !== undefined
        ? await this.pool.query(
            `SELECT (run->>'requestSeq')::int AS request_seq, ${question} AS question
             FROM ${qualifiedTable("analysis_tasks")} AS task,
               jsonb_array_elements(task.run_history) AS runs(run),
               ${found("run->'snapshot'", "$.deepAnalysis.activities[*]")}
             WHERE task.id = $1 AND run->>'id' = $3`,
            [taskId, questionId, at.runId]
          )
        : at.requestSeq !== undefined
          ? await this.pool.query(
              `SELECT request_seq, ${question} AS question
               FROM ${qualifiedTable("analysis_task_turns")}, ${found("activities", "$[*]")}
               WHERE task_id = $1 AND request_seq = $3`,
              [taskId, questionId, at.requestSeq]
            )
          : await this.pool.query(
              `SELECT request_seq, ${question} AS question
               FROM ${qualifiedTable("analysis_tasks")}, ${found("analysis_payload", "$.activities[*]")}
               WHERE id = $1`,
              [taskId, questionId]
            );
    const row = result.rows[0];
    if (!row) return null;
    return { requestSeq: row.request_seq ?? undefined, question: row.question ?? undefined };
  }

  async getLatestTaskByThread(threadId: string, domainId: string): Promise<AnalysisTask | null> {
    const result = await this.pool.query(
      `SELECT * FROM ${qualifiedTable("analysis_tasks")}
       WHERE thread_id = $1 AND domain_id = $2
       ORDER BY updated_at DESC
       LIMIT 1`,
      [threadId, domainId]
    );
    return result.rows.length > 0 ? mapTaskRow(result.rows[0]) : null;
  }

  async getTaskByThreadAndRequestSeq(
    threadId: string,
    requestSeq: number
  ): Promise<AnalysisTask | null> {
    const result = await this.pool.query(
      `SELECT * FROM ${qualifiedTable("analysis_tasks")}
       WHERE thread_id = $1
         AND request_seq = $2
       ORDER BY updated_at DESC
       LIMIT 1`,
      [threadId, requestSeq]
    );
    return result.rows.length > 0 ? mapTaskRow(result.rows[0]) : null;
  }

  async createTask(params: CreateAnalysisTaskParams): Promise<AnalysisTask> {
    const id = uuidv4();
    const now = Date.now();
    const threadId = params.threadId || `task-${id}`;
    const reportDeliverableEnabled = params.reportDeliverableEnabled !== false;

    await createThreadPlaceholder(
      threadId,
      params.name,
      params.userId,
      params.domainId,
      "deep_analysis"
    );

    await this.pool.query(
      `INSERT INTO ${qualifiedTable("analysis_tasks")}
       (id, agent_id, user_id, name, description, status, thread_id, question,
        notify_email, notify_on_complete, trigger_source, token, created_at, updated_at, domain_id,
        report_deliverable_enabled)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
      [
        id,
        params.agentId,
        params.userId,
        params.name,
        params.description || "",
        "pending",
        threadId,
        params.question,
        params.notifyEmail || null,
        params.notifyOnComplete || false,
        params.triggerSource || "manual",
        params.token || null,
        now,
        now,
        params.domainId,
        reportDeliverableEnabled,
      ]
    );
    logger.info(tApp("analysis.task.task-service.447", { id: id, name: params.name }));
    return (await this.getTask(id, params.domainId, { payload: "state", runs: "none" }))!;
  }

  /** Single-row task update: id is pinned to $1 and the remaining parameters start at $2 in `sets` order. */
  private async applyTaskUpdate(
    id: string,
    sets: string[],
    vals: any[]
  ): Promise<AnalysisTask | null> {
    const result = await this.pool.query(
      `UPDATE ${qualifiedTable("analysis_tasks")} SET ${sets.join(", ")}
       WHERE id = $1
       RETURNING *`,
      [id, ...vals]
    );
    if ((result.rowCount ?? 0) === 0) return null;
    return mapTaskRow(result.rows[0]);
  }

  /**
   * The single atomic boundary for run-attribution writes: after reading the run history with the row locked, first confirm the writing run is still
   * the most recently accepted run. Only it may rewrite the task's current state and artifacts; a late write superseded by a new run only backfills
   * its own history record by identity — it cannot touch any current fact of the new run and never appends a run record.
   *
   * Status and acceptance paths need the rewritten row back; the artifact hot path only needs
   * completion as its confirmation, so it passes `confirmationOnly` and no full row travels back.
   */
  private async applyTaskUpdateWithRunIdentity(
    id: string,
    sets: string[],
    vals: any[],
    identity: AnalysisRunIdentity,
    runPatch?: Partial<AnalysisTaskRun>
  ): Promise<AnalysisTask | null>;
  private async applyTaskUpdateWithRunIdentity(
    id: string,
    sets: string[],
    vals: any[],
    identity: AnalysisRunIdentity,
    runPatch: Partial<AnalysisTaskRun> | undefined,
    confirmationOnly: true
  ): Promise<void>;
  private async applyTaskUpdateWithRunIdentity(
    id: string,
    sets: string[],
    vals: any[],
    identity: AnalysisRunIdentity,
    runPatch?: Partial<AnalysisTaskRun>,
    confirmationOnly?: boolean
  ): Promise<AnalysisTask | null | void> {
    if (identity.runId === undefined && identity.requestSeq === undefined) {
      logger.error(tApp("analysis.task.task-service.448", { id: id }));
      return null;
    }
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const current = await client.query(
        `SELECT status, ${RUN_META_SQL} AS run_history
         FROM ${qualifiedTable("analysis_tasks")} WHERE id = $1 FOR UPDATE`,
        [id]
      );
      if (!current.rows.length) {
        await client.query("ROLLBACK");
        return null;
      }
      const row = current.rows[0];
      const history = readAnalysisRunHistory(row.run_history);
      const runUpdate = runPatch ? planAnalysisRunUpdate(history, identity, runPatch) : undefined;
      // Current facts are rewritten only while the writer is still the most recently accepted run and the task has not entered a terminal state from this run:
      // a running run's late artifacts cannot flip a settled terminal state back to running; completion of the same terminal state may still write body and time.
      const incomingStatus = (runPatch?.status ?? "running") as AnalysisTaskStatus;
      const mayWriteCurrent =
        isCurrentAnalysisRun(history, identity) &&
        (!isAnalysisTaskTerminalStatus(row.status as AnalysisTaskStatus) ||
          incomingStatus === row.status);
      if (!mayWriteCurrent && !runUpdate) {
        await client.query("ROLLBACK");
        return confirmationOnly ? undefined : null;
      }
      const nextSets = mayWriteCurrent ? [...sets] : [];
      const nextVals = mayWriteCurrent ? [...vals] : [];
      if (runUpdate) {
        // Rewrite only the attributed record: its stored snapshot never travels through Node.
        nextVals.push(String(runUpdate.index), runUpdate.index, JSON.stringify(runUpdate.patch));
        const at = nextVals.length - 1;
        nextSets.push(
          `run_history = jsonb_set(run_history, ARRAY[$${at}::text], (run_history -> $${at + 1}::int) || $${at + 2}::jsonb)`
        );
      }
      const result = await client.query(
        confirmationOnly
          ? `UPDATE ${qualifiedTable("analysis_tasks")} SET ${nextSets.join(", ")}
         WHERE id = $1`
          : `UPDATE ${qualifiedTable("analysis_tasks")} SET ${nextSets.join(", ")}
         WHERE id = $1
         RETURNING *`,
        [id, ...nextVals]
      );
      await client.query("COMMIT");
      if (confirmationOnly) return;
      if ((result.rowCount ?? 0) === 0) return null;
      return mapTaskRow(result.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async updateTaskStatus(
    id: string,
    status: AnalysisTaskStatus,
    extra?: {
      resultSummary?: string;
      lastRunAt?: number;
      /** The run this terminal state rewrites; absent means no accepted run and the write is handled as an ordinary status refresh. */
      identity?: AnalysisRunIdentity;
    }
  ): Promise<AnalysisTask | null> {
    const now = Date.now();
    const sets: string[] = ["status = $2", "updated_at = $3"];
    const vals: any[] = [status, now];
    let idx = 4;

    if (extra?.resultSummary !== undefined) {
      vals.push(extra.resultSummary);
      sets.push(`result_summary = $${idx++}`);
    }
    if (extra?.lastRunAt !== undefined) {
      vals.push(extra.lastRunAt);
      sets.push(`last_run_at = $${idx}`);
    }
    const isTerminal = status === "completed" || status === "failed" || status === "cancelled";
    const runPatch: Partial<AnalysisTaskRun> | undefined =
      isTerminal && extra?.identity !== undefined
        ? {
            status,
            completedAt: now,
            ...(extra?.resultSummary !== undefined ? { resultSummary: extra.resultSummary } : {}),
          }
        : undefined;

    const updated =
      extra?.identity !== undefined
        ? await this.applyTaskUpdateWithRunIdentity(id, sets, vals, extra.identity, runPatch)
        : await this.applyTaskUpdate(id, sets, vals);
    if (!updated) {
      logger.warn(tApp("analysis.task.task-service.449", { id: id }));
      return null;
    }
    logger.info(tApp("analysis.task.task-service.450", { id: id, status: status }));
    return updated;
  }

  /**
   * Atomically moves the task status from non-running to running (preventing concurrent duplicate execution).
   * Returns the updated task, or null when it is already running.
   */
  async tryStartTask(id: string, domainId: string): Promise<AnalysisTask | null> {
    const now = Date.now();
    const run = JSON.stringify({
      id: `${id}:${uuidv4()}`,
      status: "running",
      startedAt: now,
      createdAt: now,
    });
    const result = await this.pool.query(
      `UPDATE ${qualifiedTable("analysis_tasks")}
       SET status = 'running', last_run_at = $1, updated_at = $2, result_summary = NULL,
           analysis_payload = NULL, request_seq = NULL,
           run_history = COALESCE(run_history, '[]'::jsonb) || jsonb_build_array($3::jsonb)
       WHERE id = $4 AND domain_id = $5 AND status != 'running'
       RETURNING *`,
      [now, now, run, id, domainId]
    );
    if ((result.rowCount ?? 0) === 0) return null;
    logger.info(tApp("analysis.task.task-service.451", { id: id }));
    return mapTaskRow(result.rows[0]);
  }

  async updateTaskThread(id: string, threadId: string): Promise<AnalysisTask | null> {
    const now = Date.now();
    const result = await this.pool.query(
      `UPDATE ${qualifiedTable("analysis_tasks")}
       SET thread_id = $1, updated_at = $2
       WHERE id = $3
       RETURNING *`,
      [threadId, now, id]
    );
    if ((result.rowCount ?? 0) === 0) return null;
    return mapTaskRow(result.rows[0]);
  }

  async updateTask(
    id: string,
    domainId: string,
    updates: Partial<AnalysisTask>
  ): Promise<AnalysisTask | null> {
    const now = Date.now();
    const sets: string[] = ["updated_at = $1"];
    const vals: any[] = [now];
    let idx = 2;

    const fieldMap: Record<string, string> = {
      name: "name",
      description: "description",
      question: "question",
      token: "token",
      status: "status",
      notifyEmail: "notify_email",
      notifyOnComplete: "notify_on_complete",
      resultSummary: "result_summary",
      analysisPayload: "analysis_payload",
      triggerSource: "trigger_source",
    };

    for (const [key, col] of Object.entries(fieldMap)) {
      const value = (updates as any)[key];
      if (value !== undefined) {
        vals.push(key === "analysisPayload" ? JSON.stringify(value) : value);
        sets.push(`${col} = $${idx++}`);
      }
    }

    if (sets.length === 1) return this.getTask(id, domainId, { payload: "state", runs: "none" });

    vals.push(id, domainId);
    const result = await this.pool.query(
      `UPDATE ${qualifiedTable("analysis_tasks")} SET ${sets.join(", ")}
       WHERE id = $${idx} AND domain_id = $${idx + 1}
       RETURNING ${TASK_COLUMNS}, ${PAYLOAD_SQL.state}, ${RUNS_SQL.none}`,
      vals
    );
    if ((result.rowCount ?? 0) === 0) return null;
    return mapTaskRow(result.rows[0]);
  }

  async deleteTask(id: string, domainId: string): Promise<boolean> {
    const result = await this.pool.query(
      `DELETE FROM ${qualifiedTable("analysis_tasks")} WHERE id = $1 AND domain_id = $2 RETURNING harness_session_id, run_history`,
      [id, domainId]
    );
    if (!result.rows[0]) return false;
    const row = result.rows[0];
    const sessionIds = new Set<string>(
      readAnalysisRunHistory(row.run_history).flatMap((run) =>
        run.harnessSessionId ? [run.harnessSessionId] : []
      )
    );
    if (row.harness_session_id) sessionIds.add(row.harness_session_id);
    for (const sessionId of sessionIds) await harnessSessions.deleteSession(sessionId);
    await this.pool.query(
      `DELETE FROM ${qualifiedTable("analysis_task_events")} WHERE task_id = $1`,
      [id]
    );
    logger.info(tApp("analysis.task.task-service.452", { id: id }));
    return true;
  }

  async updateTaskArtifacts(
    id: string,
    artifacts: {
      resultSummary?: string;
      analysisPayload?: DeepAnalysisTaskPayload;
      requestSeq?: number;
    },
    /** Run identity captured at acceptance; artifacts and terminal states are run-attributed current facts, and without identity nothing is written. */
    identity?: AnalysisRunIdentity
  ): Promise<void> {
    const now = Date.now();
    const sets: string[] = ["updated_at = $2"];
    const vals: any[] = [now];
    let idx = 3;

    if (artifacts.resultSummary !== undefined) {
      vals.push(artifacts.resultSummary);
      sets.push(`result_summary = $${idx++}`);
    }
    let runPatch: Partial<AnalysisTaskRun> | undefined;
    if (artifacts.analysisPayload !== undefined) {
      vals.push(JSON.stringify(artifacts.analysisPayload));
      sets.push(`analysis_payload = $${idx++}`);
      if (artifacts.analysisPayload.runState.status !== "running") sets.push(`last_run_at = $2`);
      vals.push(artifacts.analysisPayload.runState.status);
      sets.push(`status = $${idx++}`);
      if (artifacts.analysisPayload.runState.status !== "running") {
        const terminalStatus = artifacts.analysisPayload.runState.status;
        const { resultSummary, resultReport } = buildDeepAnalysisTaskResult(
          artifacts.analysisPayload
        );
        // The run history must keep this run's own replayable snapshot. Saving only the report body would leave the frontend
        // unable to restore the task process when reviewing an old run, mistaking the report body for an assistant message.
        const snapshot = buildDeepAnalysisTaskSnapshot({
          taskId: id,
          requestSeq: artifacts.requestSeq,
          status: terminalStatus,
          payload: artifacts.analysisPayload,
          fallbackText: resultSummary,
        });
        runPatch = {
          status: terminalStatus,
          completedAt: now,
          resultSummary,
          resultReport,
          ...(artifacts.requestSeq !== undefined ? { requestSeq: artifacts.requestSeq } : {}),
          snapshot,
        };
      }
    }

    if (artifacts.requestSeq !== undefined) {
      vals.push(artifacts.requestSeq);
      sets.push(`request_seq = $${idx}`);
    }
    if (sets.length === 1) return;

    // The artifact store never consumes the rewritten row; write completion is the only
    // confirmation it needs, so the hot path returns no full task row.
    await this.applyTaskUpdateWithRunIdentity(id, sets, vals, identity ?? {}, runPatch, true);
  }

  async upsertTaskEvent(input: UpsertAnalysisTaskEventInput): Promise<void> {
    const sourceKind = input.sourceKind || "workflow_node";
    const id = `analysis-task-event:${input.taskId}:${sourceKind}:${input.sourceRef}`;
    const now = Date.now();

    await this.pool.query(
      `INSERT INTO ${qualifiedTable("analysis_task_events")}
        (id, task_id, event_seq, event_type, event_name, status, phase,
         source_kind, source_ref, payload, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)
       ON CONFLICT (task_id, source_kind, source_ref)
       DO UPDATE SET
         event_seq = EXCLUDED.event_seq,
         event_type = EXCLUDED.event_type,
         event_name = EXCLUDED.event_name,
         status = EXCLUDED.status,
         phase = EXCLUDED.phase,
         payload = EXCLUDED.payload,
         updated_at = EXCLUDED.updated_at`,
      [
        id,
        input.taskId,
        input.eventSeq,
        input.eventType,
        input.eventName,
        input.status || null,
        input.phase || null,
        sourceKind,
        input.sourceRef,
        input.payload === undefined ? null : JSON.stringify(input.payload),
        now,
      ]
    );
  }

  /**
   * Reads the structured facts of task events of one source type by event sequence.
   * The loop form uses it to read the analysis trajectory.
   */
  async listTaskEventPayloads<T>(taskId: string, sourceKind: string): Promise<T[]> {
    const result = await this.pool.query(
      `SELECT payload FROM ${qualifiedTable("analysis_task_events")}
       WHERE task_id = $1 AND source_kind = $2 AND payload IS NOT NULL
       ORDER BY event_seq ASC`,
      [taskId, sourceKind]
    );
    return result.rows.map((row) => row.payload as T);
  }

  /** Reads one task event fact by stable source identity; loop worker trajectories read on demand by dispatch activity identity. */
  async getTaskEventPayload<T>(
    taskId: string,
    sourceKind: string,
    sourceRef: string
  ): Promise<T | null> {
    const result = await this.pool.query(
      `SELECT payload FROM ${qualifiedTable("analysis_task_events")}
       WHERE task_id = $1 AND source_kind = $2 AND source_ref = $3 AND payload IS NOT NULL
       LIMIT 1`,
      [taskId, sourceKind, sourceRef]
    );
    return result.rows[0]?.payload ? (result.rows[0].payload as T) : null;
  }

  async getRunningTasks(): Promise<AnalysisTask[]> {
    const result = await this.pool.query(
      `SELECT * FROM ${qualifiedTable("analysis_tasks")}
       WHERE status = 'running'
       ORDER BY created_at DESC`
    );
    return result.rows.map(mapTaskRow);
  }

  async getTaskCountsByAgent(
    agentId: string,
    userId: string,
    domainId: string
  ): Promise<AnalysisTaskCounts> {
    const result = await this.pool.query(
      `SELECT
         COUNT(*)::int as total,
         COUNT(*) FILTER (WHERE status = 'running')::int as running,
         COUNT(*) FILTER (WHERE status = 'completed')::int as completed,
         COUNT(*) FILTER (WHERE schedule_enabled = true)::int as scheduled
       FROM (${taskListFeedSql()}) AS task_feed
       WHERE agent_id = $1 AND user_id = $2 AND domain_id = $3`,
      [agentId, userId, domainId]
    );
    const row = result.rows[0] || {};
    return {
      total: row.total || 0,
      running: row.running || 0,
      completed: row.completed || 0,
      scheduled: row.scheduled || 0,
    };
  }
}

let taskServiceInstance: AnalysisTaskService | null = null;

export function getAnalysisTaskService(): AnalysisTaskService {
  if (!taskServiceInstance) {
    taskServiceInstance = new AnalysisTaskService();
  }
  return taskServiceInstance;
}
