/**
 * Schedule rule storage and service.
 *
 * A rule stores only "when to re-ask on the user's behalf": the agent, the question, the expression, notification settings, and
 * the next trigger time. Rules never carry report results — at trigger time the scheduler claims the rule and creates a one-shot report
 * task, and the report is written only onto the task row. Claiming advances `next_run_at`, so with multiple instances one slot has exactly one winner.
 */

import pg from "pg";
import { v4 as uuidv4 } from "uuid";
import { getPostgresPool, qualifiedTable } from "../../../infrastructure/postgres";
import { createLogger } from "../../../logging/logger";
import { parseScheduleToNextRun } from "./schedule-parser";
import type { AnalysisTask } from "../task-types";
import { tApp } from "../../../i18n";


const logger = createLogger("analysis-schedule-rules");

export interface AnalysisScheduleRule {
  id: string;
  agentId: string;
  userId: string;
  domainId: string;
  name: string;
  description: string;
  question: string;
  scheduleExpression: string;
  enabled: boolean;
  notifyEmail?: string;
  notifyOnComplete: boolean;
  token?: string;
  /** Why the last trigger failed; cleared on a successful claim */
  lastError?: string;
  lastRunAt?: number;
  nextRunAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface RegisterScheduleRuleParams {
  agentId: string;
  userId: string;
  domainId: string;
  name: string;
  description?: string;
  question: string;
  scheduleExpression: string;
  notifyEmail?: string;
  notifyOnComplete?: boolean;
  token?: string;
}

export interface UpdateScheduleRuleParams {
  name?: string;
  description?: string;
  question?: string;
  scheduleExpression?: string;
  enabled?: boolean;
  notifyEmail?: string;
  notifyOnComplete?: boolean;
  token?: string;
}

interface AnalysisScheduleRuleRow {
  id: string;
  agent_id: string;
  user_id: string;
  domain_id: string;
  name: string;
  description: string | null;
  question: string | null;
  schedule_expression: string | null;
  enabled: boolean;
  notify_email: string | null;
  notify_on_complete: boolean;
  token: string | null;
  last_error: string | null;
  last_run_at: string | null;
  next_run_at: string | null;
  created_at: string;
  updated_at: string;
}

function mapRuleRow(row: AnalysisScheduleRuleRow): AnalysisScheduleRule {
  return {
    id: row.id,
    agentId: row.agent_id,
    userId: row.user_id,
    domainId: row.domain_id,
    name: row.name,
    description: row.description || "",
    question: row.question || "",
    scheduleExpression: row.schedule_expression || "",
    enabled: row.enabled,
    notifyEmail: row.notify_email || undefined,
    notifyOnComplete: row.notify_on_complete,
    token: row.token || undefined,
    lastError: row.last_error || undefined,
    lastRunAt: row.last_run_at ? parseInt(row.last_run_at, 10) : undefined,
    nextRunAt: row.next_run_at ? parseInt(row.next_run_at, 10) : undefined,
    createdAt: parseInt(row.created_at, 10),
    updatedAt: parseInt(row.updated_at, 10),
  };
}

/**
 * The rule's read model inside the existing task list endpoints: the schedule entry's external shape is unchanged,
 * and rules appear in the same list as "scheduled tasks pending trigger".
 */
export function toScheduleRuleTask(rule: AnalysisScheduleRule): AnalysisTask {
  return {
    id: rule.id,
    agentId: rule.agentId,
    userId: rule.userId,
    domainId: rule.domainId,
    name: rule.name,
    description: rule.description,
    status: "pending",
    question: rule.question,
    scheduleExpression: rule.scheduleExpression || undefined,
    scheduleEnabled: rule.enabled,
    notifyEmail: rule.notifyEmail,
    notifyOnComplete: rule.notifyOnComplete,
    resultSummary: rule.lastError,
    triggerSource: "scheduled",
    token: rule.token,
    lastRunAt: rule.lastRunAt,
    nextRunAt: rule.nextRunAt,
    createdAt: rule.createdAt,
    updatedAt: rule.updatedAt,
  };
}

/** Projects the rule table in task-list column order so the task-list read model can merge and paginate with report task rows. */
export function scheduleRuleTaskFeedSql(): string {
  return tApp("analysis.task.schedule-rules.407", { qualifiedTable: qualifiedTable("analysis_schedule_rules") });
}

export class AnalysisScheduleRuleService {
  private pool: pg.Pool;

  constructor() {
    this.pool = getPostgresPool();
  }

  async register(params: RegisterScheduleRuleParams): Promise<AnalysisScheduleRule> {
    const id = uuidv4();
    const now = Date.now();
    const nextRunAt = params.scheduleExpression
      ? parseScheduleToNextRun(params.scheduleExpression)
      : null;

    const result = await this.pool.query(
      `INSERT INTO ${qualifiedTable("analysis_schedule_rules")}
       (id, agent_id, user_id, name, description, question, schedule_expression, enabled,
        notify_email, notify_on_complete, token, next_run_at, created_at, updated_at, domain_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,true,$8,$9,$10,$11,$12,$12,$13)
       RETURNING *`,
      [
        id,
        params.agentId,
        params.userId,
        params.name,
        params.description || "",
        params.question,
        params.scheduleExpression,
        params.notifyEmail || null,
        params.notifyOnComplete || false,
        params.token || null,
        nextRunAt,
        now,
        params.domainId,
      ]
    );
    logger.info(tApp("analysis.task.schedule-rules.408", { id: id, name: params.name }));
    return mapRuleRow(result.rows[0]);
  }

  async get(id: string, domainId: string): Promise<AnalysisScheduleRule | null> {
    const result = await this.pool.query(
      `SELECT * FROM ${qualifiedTable("analysis_schedule_rules")} WHERE id = $1 AND domain_id = $2`,
      [id, domainId]
    );
    return result.rows[0] ? mapRuleRow(result.rows[0]) : null;
  }

  /** Recomputes the next trigger time when the expression comes with this update; disabled rules are never scheduled again. */
  async update(
    id: string,
    domainId: string,
    updates: UpdateScheduleRuleParams
  ): Promise<AnalysisScheduleRule | null> {
    const now = Date.now();
    const sets: string[] = ["updated_at = $1"];
    const vals: unknown[] = [now];
    let idx = 2;

    const fieldMap: Record<keyof UpdateScheduleRuleParams, string> = {
      name: "name",
      description: "description",
      question: "question",
      scheduleExpression: "schedule_expression",
      enabled: "enabled",
      notifyEmail: "notify_email",
      notifyOnComplete: "notify_on_complete",
      token: "token",
    };
    for (const [key, column] of Object.entries(fieldMap)) {
      const value = updates[key as keyof UpdateScheduleRuleParams];
      if (value !== undefined) {
        vals.push(value);
        sets.push(`${column} = $${idx++}`);
      }
    }

    if (updates.enabled === false) {
      sets.push("next_run_at = NULL");
    } else if (updates.scheduleExpression) {
      vals.push(parseScheduleToNextRun(updates.scheduleExpression));
      sets.push(`next_run_at = $${idx++}`);
    }

    vals.push(id, domainId);
    const result = await this.pool.query(
      `UPDATE ${qualifiedTable("analysis_schedule_rules")} SET ${sets.join(", ")}
       WHERE id = $${idx} AND domain_id = $${idx + 1}
       RETURNING *`,
      vals
    );
    return result.rows[0] ? mapRuleRow(result.rows[0]) : null;
  }

  async remove(id: string, domainId: string): Promise<boolean> {
    const result = await this.pool.query(
      `DELETE FROM ${qualifiedTable("analysis_schedule_rules")} WHERE id = $1 AND domain_id = $2`,
      [id, domainId]
    );
    if ((result.rowCount ?? 0) > 0) {
      logger.info(tApp("analysis.task.schedule-rules.409", { id: id }));
      return true;
    }
    return false;
  }

  async listDue(now: number): Promise<AnalysisScheduleRule[]> {
    const result = await this.pool.query(
      `SELECT * FROM ${qualifiedTable("analysis_schedule_rules")}
       WHERE enabled = true
         AND next_run_at IS NOT NULL
         AND next_run_at <= $1
       ORDER BY next_run_at ASC`,
      [now]
    );
    return result.rows.map(mapRuleRow);
  }

  /**
   * Claims one trigger: only a rule still sitting at `expectedNextRunAt` is advanced.
   * The advance itself is the concurrency guard and also ensures a failed trigger is not retried every tick.
   */
  async claim(
    id: string,
    expectedNextRunAt: number | undefined,
    nextRunAt: number,
    triggeredAt: number
  ): Promise<AnalysisScheduleRule | null> {
    const result = await this.pool.query(
      `UPDATE ${qualifiedTable("analysis_schedule_rules")}
       SET next_run_at = $2, last_run_at = $3, last_error = NULL, updated_at = $3
       WHERE id = $1 AND enabled = true AND next_run_at IS NOT DISTINCT FROM $4
       RETURNING *`,
      [id, nextRunAt, triggeredAt, expectedNextRunAt ?? null]
    );
    return result.rows[0] ? mapRuleRow(result.rows[0]) : null;
  }

  async recordTriggerError(id: string, message: string): Promise<void> {
    await this.pool.query(
      `UPDATE ${qualifiedTable("analysis_schedule_rules")}
       SET last_error = $2, updated_at = $3
       WHERE id = $1`,
      [id, message, Date.now()]
    );
  }
}

let scheduleRuleServiceInstance: AnalysisScheduleRuleService | null = null;

export function getAnalysisScheduleRuleService(): AnalysisScheduleRuleService {
  if (!scheduleRuleServiceInstance) {
    scheduleRuleServiceInstance = new AnalysisScheduleRuleService();
  }
  return scheduleRuleServiceInstance;
}
