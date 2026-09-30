import type { AnalysisDimension } from "@ontomato/contracts/analysis-agent";
import pg from "pg";
import { v4 as uuidv4 } from "uuid";
import { getPostgresPool, qualifiedTable } from "../../../infrastructure/postgres";
import { createLogger } from "../../../logging/logger";
import { tApp } from "../../../i18n";


const logger = createLogger("analysis-agent-service");

interface AnalysisDimensionRow {
  id: string;
  agent_id: string;
  name: string;
  dimension_type: string | null;
  values: any;
  value_source: string | null;
  dataset_field: string | null;
  sub_question_template: string | null;
  order: number;
  is_enabled: boolean;
  created_at: string;
  updated_at: string;
}

export class AnalysisDimensionService {
  private pool: pg.Pool;

  constructor() {
    this.pool = getPostgresPool();
  }

  async listDimensions(agentId: string, domainId?: string): Promise<AnalysisDimension[]> {
    const result = await this.pool.query(
      `SELECT d.* FROM ${qualifiedTable("analysis_dimensions")} d
       JOIN ${qualifiedTable("analysis_agents")} a ON a.id = d.agent_id
       WHERE d.agent_id = $1 AND a.domain_id = $2
       ORDER BY d."order", d.created_at`,
      [agentId, domainId || null]
    );
    return result.rows.map(mapDimRow);
  }

  async getEnabledDimensions(agentId: string, domainId?: string): Promise<AnalysisDimension[]> {
    const result = await this.pool.query(
      `SELECT d.* FROM ${qualifiedTable("analysis_dimensions")} d
       JOIN ${qualifiedTable("analysis_agents")} a ON a.id = d.agent_id
       WHERE d.agent_id = $1 AND a.domain_id = $2 AND d.is_enabled = true
       ORDER BY d."order", d.created_at`,
      [agentId, domainId || null]
    );
    return result.rows.map(mapDimRow);
  }

  async getDimension(id: string, domainId?: string): Promise<AnalysisDimension | null> {
    const result = await this.pool.query(
      `SELECT d.* FROM ${qualifiedTable("analysis_dimensions")} d
       JOIN ${qualifiedTable("analysis_agents")} a ON a.id = d.agent_id
       WHERE d.id = $1 AND a.domain_id = $2`,
      [id, domainId || null]
    );
    return result.rows.length > 0 ? mapDimRow(result.rows[0]) : null;
  }

  async createDimension(
    dimension: Omit<AnalysisDimension, "id" | "createdAt" | "updatedAt">,
    domainId: string
  ): Promise<AnalysisDimension> {
    const id = uuidv4();
    const now = Date.now();
    await this.pool.query(
      `INSERT INTO ${qualifiedTable("analysis_dimensions")}
       (id, agent_id, name, dimension_type, values, value_source, dataset_field,
        sub_question_template, "order", is_enabled, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        id,
        dimension.agentId,
        dimension.name,
        dimension.dimensionType || null,
        dimension.values ? JSON.stringify(dimension.values) : null,
        dimension.valueSource || null,
        dimension.datasetField || null,
        dimension.subQuestionTemplate || null,
        dimension.order ?? 0,
        dimension.isEnabled !== false ? true : false,
        now,
        now,
      ]
    );
    logger.info(tApp("analysis.config.dimension-service.12", { id: id, name: dimension.name, agentId: dimension.agentId }));
    return (await this.getDimension(id, domainId))!;
  }

  async updateDimension(
    id: string,
    updates: Partial<AnalysisDimension>,
    domainId?: string
  ): Promise<AnalysisDimension | null> {
    const now = Date.now();
    const sets: string[] = ["updated_at = $1"];
    const vals: any[] = [now];
    let idx = 2;

    if (updates.name !== undefined) {
      vals.push(updates.name);
      sets.push(`name = $${idx++}`);
    }
    if (updates.dimensionType !== undefined) {
      vals.push(updates.dimensionType);
      sets.push(`dimension_type = $${idx++}`);
    }
    if (updates.values !== undefined) {
      vals.push(JSON.stringify(updates.values));
      sets.push(`values = $${idx++}`);
    }
    if (updates.valueSource !== undefined) {
      vals.push(updates.valueSource);
      sets.push(`value_source = $${idx++}`);
    }
    if (updates.datasetField !== undefined) {
      vals.push(updates.datasetField);
      sets.push(`dataset_field = $${idx++}`);
    }
    if (updates.subQuestionTemplate !== undefined) {
      vals.push(updates.subQuestionTemplate);
      sets.push(`sub_question_template = $${idx++}`);
    }
    if (updates.order !== undefined) {
      vals.push(updates.order);
      sets.push(`"order" = $${idx++}`);
    }
    if (updates.isEnabled !== undefined) {
      vals.push(updates.isEnabled);
      sets.push(`is_enabled = $${idx++}`);
    }

    if (sets.length === 1) return this.getDimension(id, domainId);

    vals.push(id, domainId || null);
    const result = await this.pool.query(
      `UPDATE ${qualifiedTable("analysis_dimensions")} SET ${sets.join(", ")}
       WHERE id = $${idx} AND agent_id IN (
         SELECT id FROM ${qualifiedTable("analysis_agents")} WHERE domain_id = $${idx + 1}
       )
       RETURNING *`,
      vals
    );

    if ((result.rowCount ?? 0) === 0) {
      logger.warn(tApp("analysis.config.dimension-service.13", { id: id }));
      return null;
    }
    logger.info(tApp("analysis.config.dimension-service.14", { id: id }));
    return mapDimRow(result.rows[0]);
  }

  async deleteDimension(id: string, domainId?: string): Promise<boolean> {
    const result = await this.pool.query(
      `DELETE FROM ${qualifiedTable("analysis_dimensions")} d
       USING ${qualifiedTable("analysis_agents")} a
       WHERE d.id = $1 AND d.agent_id = a.id AND a.domain_id = $2`,
      [id, domainId || null]
    );
    if ((result.rowCount ?? 0) > 0) {
      logger.info(tApp("analysis.config.dimension-service.15", { id: id }));
      return true;
    }
    logger.warn(tApp("analysis.config.dimension-service.16", { id: id }));
    return false;
  }

  async deleteDimensionsByAgent(agentId: string, domainId?: string): Promise<number> {
    const result = await this.pool.query(
      `DELETE FROM ${qualifiedTable("analysis_dimensions")} d
       USING ${qualifiedTable("analysis_agents")} a
       WHERE d.agent_id = $1 AND d.agent_id = a.id AND a.domain_id = $2`,
      [agentId, domainId || null]
    );
    const deleted = result.rowCount ?? 0;
    logger.info(tApp("analysis.config.dimension-service.17", { agentId: agentId, deleted: deleted }));
    return deleted;
  }

  validateDimension(dimension: AnalysisDimension): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!dimension.name || dimension.name.trim() === "") {
      errors.push(tApp("analysis.config.dimension-service.18"));
    }

    if (!dimension.subQuestionTemplate || dimension.subQuestionTemplate.trim() === "") {
      errors.push(tApp("analysis.config.dimension-service.19"));
    }

    if (
      dimension.valueSource === "static" &&
      (!dimension.values || dimension.values.length === 0)
    ) {
      errors.push(tApp("analysis.config.dimension-service.20"));
    }

    if (dimension.valueSource === "dataset_field" && !dimension.datasetField) {
      errors.push(tApp("analysis.config.dimension-service.21"));
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}

let analysisDimensionService: AnalysisDimensionService | null = null;

export function getAnalysisDimensionService(): AnalysisDimensionService {
  if (!analysisDimensionService) {
    analysisDimensionService = new AnalysisDimensionService();
  }
  return analysisDimensionService;
}

function mapDimRow(row: AnalysisDimensionRow): AnalysisDimension {
  return {
    id: row.id,
    agentId: row.agent_id,
    name: row.name,
    dimensionType: (row.dimension_type || "categorical") as AnalysisDimension["dimensionType"],
    values: row.values,
    valueSource: (row.value_source || "static") as AnalysisDimension["valueSource"],
    datasetField: row.dataset_field || undefined,
    subQuestionTemplate: row.sub_question_template || "",
    order: row.order,
    isEnabled: row.is_enabled,
    createdAt: parseInt(row.created_at, 10),
    updatedAt: parseInt(row.updated_at, 10),
  };
}
