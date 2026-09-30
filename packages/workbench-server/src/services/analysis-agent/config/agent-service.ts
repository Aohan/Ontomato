import type { AnalysisAgent } from "@ontomato/contracts/analysis-agent";
import pg from "pg";
import { createLogger } from "../../../logging/logger";
import {
  DEFAULT_ANALYSIS_AGENT_EXECUTION_MODE,
  DEFAULT_ANALYSIS_REPORT_SUMMARY_POSITION,
  isAnalysisAgentExecutionMode,
  isAnalysisReportSummaryPosition,
} from "./agent-types";
import { v4 as uuidv4 } from "uuid";
import { getPostgresPool, qualifiedTable } from "../../../infrastructure/postgres";
import { renderPrompt } from "../../../core/prompts/loader";
import { SkillCategory, SkillType } from "../../../core/skills/constants";
import { skillRegistryManager } from "../../../core/skills/registry/manager";
import { t, tApp } from "../../../i18n";

const logger = createLogger("analysis-agent-service");


const DEFAULT_AGENT_SORT_ORDER = 0;

function defaultAgentName() {
  return t("service.defaultAgentName");
}

function defaultAgentDescription() {
  return t("service.defaultAgentDescription");
}

function getDefaultAnalysisDimensionPrompt(): string {
  return renderPrompt("analysis-agent.shared.analysis-dimension.user");
}

function getDefaultSummarizerPrompt(): string {
  return renderPrompt("analysis-agent.shared.summarizer.user");
}

function getDefaultConclusionMakerPrompt(): string {
  return renderPrompt("analysis-agent.shared.conclusion-maker.user");
}

interface AnalysisAgentRow {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  execution_mode: string | null;
  loop_prompt: string | null;
  report_deliverable_enabled: boolean;
  hot_report_enabled: boolean;
  analysis_dimension_prompt: string | null;
  summarizer_prompt: string | null;
  conclusion_maker_prompt: string | null;
  summary_position?: string | null;
  enabled_skill_ids: string[] | null;
  enabled_visualization_skill_ids: string[] | null;
  enabled_mcp_service_names: string[] | null;
  class_names: string[] | null;
  is_enabled: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export class InvalidAgentSkillSelectionError extends Error {
  readonly code = "INVALID_AGENT_SKILL_SELECTION";

  constructor(message: string) {
    super(message);
    this.name = "InvalidAgentSkillSelectionError";
  }
}

export class AnalysisAgentService {
  private pool: pg.Pool;

  constructor() {
    this.pool = getPostgresPool();
  }

  async initialize(): Promise<void> {
    logger.info(tApp("analysis.config.agent-service.1"));
  }

  private async seedDefaultAgent(domainId: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`seed-agent-${domainId}`]);
      const existing = await client.query(
        `SELECT id, name FROM ${qualifiedTable("analysis_agents")}
         WHERE sort_order = $1 AND domain_id = $2 LIMIT 1`,
        [DEFAULT_AGENT_SORT_ORDER, domainId]
      );
      const name = defaultAgentName();
      const description = defaultAgentDescription();

      if ((existing.rowCount ?? 0) > 0) {
        const row = existing.rows[0];
        if (row.name !== name) {
          await client.query(
            `UPDATE ${qualifiedTable("analysis_agents")}
             SET name = $1, description = $2, updated_at = $3
             WHERE id = $4 AND domain_id = $5`,
            [name, description, Date.now(), row.id, domainId]
          );
        }
      } else {
        const now = Date.now();
        await client.query(
          `INSERT INTO ${qualifiedTable("analysis_agents")}
           (id, name, description, analysis_dimension_prompt, summarizer_prompt,
            conclusion_maker_prompt, enabled_skill_ids, enabled_visualization_skill_ids,
            enabled_mcp_service_names, class_names, is_enabled, sort_order, domain_id,
            report_deliverable_enabled, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
          [
            uuidv4(),
            name,
            description,
            getDefaultAnalysisDimensionPrompt(),
            getDefaultSummarizerPrompt(),
            getDefaultConclusionMakerPrompt(),
            [],
            await this.getDefaultVisualizationSkillIds(domainId),
            [],
            [],
            true,
            DEFAULT_AGENT_SORT_ORDER,
            domainId,
            true,
            now,
            now,
          ]
        );
        logger.info(tApp("analysis.config.agent-service.2"), { domainId });
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async listAgents(domainId?: string): Promise<AnalysisAgent[]> {
    if (domainId) await this.seedDefaultAgent(domainId);
    const result = await this.pool.query(
      `SELECT * FROM ${qualifiedTable("analysis_agents")}
       WHERE domain_id = $1 ORDER BY sort_order ASC, created_at DESC`,
      [domainId || null]
    );
    return result.rows.map(mapAgentRow);
  }

  async getEnabledAgents(domainId?: string): Promise<AnalysisAgent[]> {
    if (domainId) await this.seedDefaultAgent(domainId);
    const result = await this.pool.query(
      `SELECT * FROM ${qualifiedTable("analysis_agents")}
       WHERE domain_id = $1 AND is_enabled = true
       ORDER BY sort_order ASC, created_at DESC`,
      [domainId || null]
    );
    return result.rows.map(mapAgentRow);
  }

  async getAgent(id: string, domainId?: string): Promise<AnalysisAgent | null> {
    const result = await this.pool.query(
      `SELECT * FROM ${qualifiedTable("analysis_agents")} WHERE id = $1 AND domain_id = $2`,
      [id, domainId || null]
    );
    return result.rows.length > 0 ? mapAgentRow(result.rows[0]) : null;
  }

  async createAgent(
    agent: Omit<AnalysisAgent, "id" | "createdAt" | "updatedAt" | "reportDeliverableEnabled"> & {
      reportDeliverableEnabled?: boolean;
    },
    domainId: string
  ): Promise<AnalysisAgent> {
    const enabledSkillIds = agent.enabledSkillIds === undefined ? [] : agent.enabledSkillIds;
    const enabledVisualizationSkillIds =
      agent.enabledVisualizationSkillIds === undefined
        ? await this.getDefaultVisualizationSkillIds(domainId)
        : agent.enabledVisualizationSkillIds;
    const enabledMcpServiceNames = normalizeStringList(agent.enabledMcpServiceNames);
    const classNames = normalizeStringList(agent.classNames);
    await this.validateSkillSelections(enabledSkillIds, SkillCategory.ANALYSIS, domainId);
    await this.validateSkillSelections(
      enabledVisualizationSkillIds,
      SkillCategory.VISUALIZATION,
      domainId
    );

    const id = uuidv4();
    const now = Date.now();
    await this.pool.query(
       `INSERT INTO ${qualifiedTable("analysis_agents")}
       (id, name, description, icon, execution_mode, loop_prompt,
        analysis_dimension_prompt, summarizer_prompt,
        conclusion_maker_prompt, enabled_skill_ids, enabled_visualization_skill_ids,
        enabled_mcp_service_names, class_names, is_enabled, sort_order, domain_id,
        report_deliverable_enabled, hot_report_enabled, summary_position, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)`,
      [
        id,
        agent.name,
        agent.description || null,
        agent.icon || null,
        isAnalysisAgentExecutionMode(agent.executionMode)
          ? agent.executionMode
          : DEFAULT_ANALYSIS_AGENT_EXECUTION_MODE,
        agent.loopPrompt || null,
        agent.analysisDimensionPrompt || null,
        agent.summarizerPrompt || null,
        agent.conclusionMakerPrompt || null,
        enabledSkillIds,
        enabledVisualizationSkillIds,
        enabledMcpServiceNames,
        classNames,
        agent.isEnabled !== false ? true : false,
        agent.sortOrder ?? 0,
        domainId,
        agent.reportDeliverableEnabled ?? true,
        agent.hotReportEnabled ?? true,
        isAnalysisReportSummaryPosition(agent.summaryPosition)
          ? agent.summaryPosition
          : DEFAULT_ANALYSIS_REPORT_SUMMARY_POSITION,
        now,
        now,
      ]
    );
    logger.info(tApp("analysis.config.agent-service.3", { id: id, name: agent.name }));
    return (await this.getAgent(id, domainId))!;
  }

  async updateAgent(
    id: string,
    updates: Partial<AnalysisAgent>,
    domainId?: string
  ): Promise<AnalysisAgent | null> {
    if (updates.enabledSkillIds !== undefined) {
      await this.validateSkillSelections(updates.enabledSkillIds, SkillCategory.ANALYSIS, domainId);
    }
    if (updates.enabledVisualizationSkillIds !== undefined) {
      await this.validateSkillSelections(
        updates.enabledVisualizationSkillIds,
        SkillCategory.VISUALIZATION,
        domainId
      );
    }
    if (updates.enabledMcpServiceNames !== undefined) {
      updates.enabledMcpServiceNames = normalizeStringList(updates.enabledMcpServiceNames);
    }
    if (updates.classNames !== undefined) {
      updates.classNames = normalizeStringList(updates.classNames);
    }

    const now = Date.now();
    const sets: string[] = ["updated_at = $1"];
    const vals: any[] = [now];
    let idx = 2;

    if (updates.name !== undefined) {
      vals.push(updates.name);
      sets.push(`name = $${idx++}`);
    }
    if (updates.description !== undefined) {
      vals.push(updates.description);
      sets.push(`description = $${idx++}`);
    }
    if (updates.icon !== undefined) {
      vals.push(updates.icon);
      sets.push(`icon = $${idx++}`);
    }
    if (updates.executionMode !== undefined) {
      vals.push(
        isAnalysisAgentExecutionMode(updates.executionMode)
          ? updates.executionMode
          : DEFAULT_ANALYSIS_AGENT_EXECUTION_MODE
      );
      sets.push(`execution_mode = $${idx++}`);
    }
    if (updates.reportDeliverableEnabled !== undefined) {
      vals.push(updates.reportDeliverableEnabled);
      sets.push(`report_deliverable_enabled = $${idx++}`);
    }
    if (updates.hotReportEnabled !== undefined) {
      vals.push(updates.hotReportEnabled);
      sets.push(`hot_report_enabled = $${idx++}`);
    }
    if (updates.enabledMcpServiceNames !== undefined) {
      vals.push(updates.enabledMcpServiceNames);
      sets.push(`enabled_mcp_service_names = $${idx++}`);
    }
    if (updates.loopPrompt !== undefined) {
      vals.push(updates.loopPrompt);
      sets.push(`loop_prompt = $${idx++}`);
    }
    if (updates.analysisDimensionPrompt !== undefined) {
      vals.push(updates.analysisDimensionPrompt);
      sets.push(`analysis_dimension_prompt = $${idx++}`);
    }
    if (updates.summarizerPrompt !== undefined) {
      vals.push(updates.summarizerPrompt);
      sets.push(`summarizer_prompt = $${idx++}`);
    }
    if (updates.conclusionMakerPrompt !== undefined) {
      vals.push(updates.conclusionMakerPrompt);
      sets.push(`conclusion_maker_prompt = $${idx++}`);
    }
    if (updates.summaryPosition !== undefined) {
      vals.push(
        isAnalysisReportSummaryPosition(updates.summaryPosition)
          ? updates.summaryPosition
          : DEFAULT_ANALYSIS_REPORT_SUMMARY_POSITION
      );
      sets.push(`summary_position = $${idx++}`);
    }
    if (updates.enabledSkillIds !== undefined) {
      vals.push(updates.enabledSkillIds);
      sets.push(`enabled_skill_ids = $${idx++}`);
    }
    if (updates.enabledVisualizationSkillIds !== undefined) {
      vals.push(updates.enabledVisualizationSkillIds);
      sets.push(`enabled_visualization_skill_ids = $${idx++}`);
    }
    if (updates.classNames !== undefined) {
      vals.push(updates.classNames);
      sets.push(`class_names = $${idx++}`);
    }
    if (updates.isEnabled !== undefined) {
      vals.push(updates.isEnabled);
      sets.push(`is_enabled = $${idx++}`);
    }
    if (updates.sortOrder !== undefined) {
      vals.push(updates.sortOrder);
      sets.push(`sort_order = $${idx++}`);
    }

    if (sets.length === 1) return this.getAgent(id, domainId);

    vals.push(id, domainId || null);
    const result = await this.pool.query(
      `UPDATE ${qualifiedTable("analysis_agents")} SET ${sets.join(", ")}
       WHERE id = $${idx} AND domain_id = $${idx + 1}
       RETURNING *`,
      vals
    );

    if ((result.rowCount ?? 0) === 0) {
      logger.warn(tApp("analysis.config.agent-service.4", { id: id }));
      return null;
    }
    logger.info(tApp("analysis.config.agent-service.5", { id: id }));
    return mapAgentRow(result.rows[0]);
  }

  async deleteAgent(id: string, domainId?: string): Promise<boolean> {
    await this.pool.query(
      `DELETE FROM ${qualifiedTable("analysis_dimensions")}
       WHERE agent_id = $1 AND EXISTS (
         SELECT 1 FROM ${qualifiedTable("analysis_agents")}
         WHERE id = $1 AND domain_id = $2
       )`,
      [id, domainId || null]
    );
    const result = await this.pool.query(
      `DELETE FROM ${qualifiedTable("analysis_agents")} WHERE id = $1 AND domain_id = $2`,
      [id, domainId || null]
    );
    if ((result.rowCount ?? 0) > 0) {
      logger.info(tApp("analysis.config.agent-service.6", { id: id }));
      return true;
    }
    logger.warn(tApp("analysis.config.agent-service.7", { id: id }));
    return false;
  }

  private async getDefaultVisualizationSkillIds(domainId: string): Promise<string[]> {
    const registry = await skillRegistryManager.forDomain(domainId);
    return registry
      .getSkills({
        category: SkillCategory.VISUALIZATION,
        type: SkillType.EXECUTABLE,
      })
      .map((skill) => skill.id);
  }

  private async validateSkillSelections(
    skillIds: string[],
    category: (typeof SkillCategory)[keyof typeof SkillCategory],
    domainId?: string
  ): Promise<void> {
    if (!Array.isArray(skillIds) || skillIds.some((skillId) => typeof skillId !== "string")) {
      throw new InvalidAgentSkillSelectionError(tApp("analysis.config.agent-service.8"));
    }

    if (!domainId) {
      throw new InvalidAgentSkillSelectionError("domainId is required");
    }
    const registry = await skillRegistryManager.forDomain(domainId);
    const catalog = new Map(
      registry.getSkills({ includeDisabled: true }).map((skill) => [skill.id, skill])
    );

    for (const skillId of new Set(skillIds)) {
      const skill = catalog.get(skillId);
      if (!skill) {
        throw new InvalidAgentSkillSelectionError(tApp("analysis.config.agent-service.9", { skillId: skillId }));
      }
      if (skill.manifest.category !== category) {
        throw new InvalidAgentSkillSelectionError(
          tApp("analysis.config.agent-service.10", { skillId: skillId, category: skill.manifest.category, category2: category })
        );
      }
      if (
        category === SkillCategory.VISUALIZATION &&
        skill.manifest.type !== SkillType.EXECUTABLE
      ) {
        throw new InvalidAgentSkillSelectionError(tApp("analysis.config.agent-service.11", { skillId: skillId }));
      }
    }
  }
}

let analysisAgentService: AnalysisAgentService | null = null;

/** The single accessor for AnalysisAgentService: instantiated and initialized once per process. */
export async function getAnalysisAgentService(): Promise<AnalysisAgentService> {
  if (!analysisAgentService) {
    analysisAgentService = new AnalysisAgentService();
    await analysisAgentService.initialize();
  }
  return analysisAgentService;
}

function mapAgentRow(row: AnalysisAgentRow): AnalysisAgent {
  return {
    id: row.id,
    name: row.name,
    description: row.description || "",
    icon: row.icon || undefined,
    executionMode: isAnalysisAgentExecutionMode(row.execution_mode)
      ? row.execution_mode
      : DEFAULT_ANALYSIS_AGENT_EXECUTION_MODE,
    loopPrompt: row.loop_prompt || undefined,
    reportDeliverableEnabled: row.report_deliverable_enabled !== false,
    hotReportEnabled: row.hot_report_enabled !== false,
    analysisDimensionPrompt: row.analysis_dimension_prompt || getDefaultAnalysisDimensionPrompt(),
    summarizerPrompt: row.summarizer_prompt || getDefaultSummarizerPrompt(),
    conclusionMakerPrompt: row.conclusion_maker_prompt || getDefaultConclusionMakerPrompt(),
    summaryPosition: isAnalysisReportSummaryPosition(row.summary_position)
      ? row.summary_position
      : DEFAULT_ANALYSIS_REPORT_SUMMARY_POSITION,
    enabledSkillIds: row.enabled_skill_ids || [],
    enabledVisualizationSkillIds: row.enabled_visualization_skill_ids || [],
    enabledMcpServiceNames: row.enabled_mcp_service_names || [],
    classNames: row.class_names || [],
    isEnabled: row.is_enabled,
    sortOrder: row.sort_order ?? 0,
    createdAt: parseInt(row.created_at, 10),
    updatedAt: parseInt(row.updated_at, 10),
  };
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((item) => String(item).trim()).filter(Boolean)));
}
