/**
 * 定时规则存储与服务。
 *
 * 规则只保存"什么时候替用户重新问一次"这件事：智能体、提问、表达式、通知配置与
 * 下次触发时刻。规则不承载报告结果——到点由调度器认领规则并新建一次性报告任务，
 * 报告只写在任务行上。认领即推进 `next_run_at`，多实例下同一槽位只会有一个赢家。
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
  /** 上一次触发失败的原因；成功认领时清空 */
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
 * 规则在既有任务列表接口里的读模型：定时入口的对外形状不变，
 * 规则以"待触发的定时任务"出现在同一个列表里。
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

/** 规则表按任务列表列序投影，供任务列表读模型与报告任务行合并分页。 */
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

  /** 表达式随本次更新给出时重算下次触发时刻；停用的规则不再排期。 */
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
   * 认领一次触发：只有仍停在 `expectedNextRunAt` 的规则会被推进，
   * 推进本身即是并发保护，也保证触发失败不会每 tick 重试。
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
