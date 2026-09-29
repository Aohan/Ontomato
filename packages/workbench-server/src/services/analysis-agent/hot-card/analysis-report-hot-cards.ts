import type { AnalysisReportHotCard } from "@ontomato/contracts/analysis-report";
import type { AnalysisReportHotCardSummary } from "@ontomato/contracts/analysis-report";
import pg from "pg";
import { createLogger } from "../../../logging/logger";

import { v4 as uuidv4 } from "uuid";
import { getPostgresPool, qualifiedTable } from "../../../infrastructure/postgres";
import { tApp } from "../../../i18n";


const logger = createLogger("analysis-report-hot-cards");

type CardInput = Omit<AnalysisReportHotCard, "id" | "createdAt" | "updatedAt"> & {
  domainId?: string;
};
type CardFilter = {
  domainId: string | undefined;
  status?: string;
  statuses?: string[];
  question?: string;
  agentId?: string;
};
type CardProjection = "detail" | "summary" | "matchCandidate";
type CardProjectionResult<P extends CardProjection> = P extends "detail"
  ? AnalysisReportHotCard[]
  : P extends "summary"
    ? AnalysisReportHotCardSummary[]
    : AnalysisReportHotCardMatchCandidate[];

export type AnalysisReportHotCardMatchCandidate = AnalysisReportHotCardSummary;

interface CardRow {
  id: string;
  question: string;
  dimensions: any;
  report_content: string | null;
  status: string;
  business_description: string | null;
  agent_id: string | null;
  session_id: string | null;
  created_at: string;
  updated_at: string;
}

interface CardSummaryRow {
  id: string;
  question: string;
  status: string;
  business_description: string | null;
  agent_id: string | null;
  created_at: string;
  updated_at: string;
  dimension_names: string[] | null;
  question_total: number | string | null;
}

function buildCardWhereClause(filter: CardFilter): {
  whereClause: string;
  params: any[];
} {
  const conditions = ["domain_id = $1"];
  const params: any[] = [filter.domainId || null];

  if (filter.status) {
    params.push(filter.status);
    conditions.push(`status = $${params.length}`);
  }
  if (filter.statuses && filter.statuses.length > 0) {
    const placeholders = filter.statuses.map((_, i) => `$${params.length + i + 1}`);
    params.push(...filter.statuses);
    conditions.push(`status IN (${placeholders.join(", ")})`);
  }
  if (filter.question) {
    params.push(filter.question);
    conditions.push(`question = $${params.length}`);
  }
  if (filter.agentId) {
    params.push(filter.agentId);
    conditions.push(`agent_id = $${params.length}`);
  }

  return { whereClause: `WHERE ${conditions.join(" AND ")}`, params };
}

function getPool(): pg.Pool {
  return getPostgresPool();
}

const SAFE_DIMENSIONS_SQL = `
  CASE
    WHEN jsonb_typeof(dimensions) = 'array' THEN dimensions
    ELSE '[]'::jsonb
  END
`;

const CARD_SUMMARY_SELECT_SQL = `
  id,
  question,
  status,
  business_description,
  agent_id,
  created_at,
  updated_at,
  (
    SELECT COALESCE(
      jsonb_agg(dim.value ->> 'dimensionName' ORDER BY dim.ordinality)
        FILTER (WHERE dim.value ? 'dimensionName'),
      '[]'::jsonb
    )
    FROM jsonb_array_elements(${SAFE_DIMENSIONS_SQL}) WITH ORDINALITY AS dim(value, ordinality)
  ) AS dimension_names,
  (
    SELECT COALESCE(
      SUM(
        CASE
          WHEN jsonb_typeof(dim.value -> 'subQuestions') = 'array'
            THEN jsonb_array_length(dim.value -> 'subQuestions')
          ELSE 0
        END
      ),
      0
    )::int
    FROM jsonb_array_elements(${SAFE_DIMENSIONS_SQL}) AS dim(value)
  ) AS question_total
`;

export async function listCards<P extends CardProjection = "detail">(
  filter: CardFilter,
  options?: { projection?: P }
): Promise<CardProjectionResult<P>> {
  const pool = getPool();
  const { whereClause, params } = buildCardWhereClause(filter);
  const projection = options?.projection || "detail";

  if (projection === "summary" || projection === "matchCandidate") {
    const result = await pool.query(
      `SELECT ${CARD_SUMMARY_SELECT_SQL}
       FROM ${qualifiedTable("analysis_report_hot_cards")}
       ${whereClause} ORDER BY created_at DESC`,
      params
    );
    return result.rows.map(mapSummaryRow) as CardProjectionResult<P>;
  }

  const result = await pool.query(
    `SELECT * FROM ${qualifiedTable("analysis_report_hot_cards")}
     ${whereClause} ORDER BY created_at DESC`,
    params
  );
  return result.rows.map(mapRow) as CardProjectionResult<P>;
}

export async function getCardById(
  id: string,
  domainId?: string
): Promise<AnalysisReportHotCard | null> {
  const pool = getPool();
  const result = await pool.query(
    `SELECT * FROM ${qualifiedTable("analysis_report_hot_cards")}
     WHERE id = $1 AND domain_id = $2`,
    [id, domainId || null]
  );
  return result.rows.length > 0 ? mapRow(result.rows[0]) : null;
}

export async function createCard(input: CardInput): Promise<AnalysisReportHotCard> {
  const pool = getPool();
  const id = uuidv4();
  const now = Date.now();
  if (!input.domainId) {
    logger.warn(tApp("analysis.hot-card.analysis-report-hot-cards.206"), {
      agentId: input.agentId,
    });
  }
  const result = await pool.query(
    `INSERT INTO ${qualifiedTable("analysis_report_hot_cards")}
     (id, question, dimensions, report_content, status, business_description, agent_id, session_id,
      domain_id, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING *`,
    [
      id,
      input.question,
      JSON.stringify(input.dimensions),
      input.reportContent || null,
      input.status || "PENDING_REVIEW",
      input.businessDescription || null,
      input.agentId || null,
      input.sessionId || null,
      input.domainId || null,
      now,
      now,
    ]
  );
  logger.info(tApp("analysis.hot-card.analysis-report-hot-cards.207", { id: id, slice: input.question.slice(0, 50) }));
  return mapRow(result.rows[0]);
}

export async function updateCardStatus(
  id: string,
  status: "PENDING_REVIEW" | "PUBLISHED" | "UNUSED",
  domainId?: string
): Promise<AnalysisReportHotCard | null> {
  const pool = getPool();
  const now = Date.now();
  const result = await pool.query(
    `UPDATE ${qualifiedTable("analysis_report_hot_cards")}
     SET status = $1, updated_at = $2
     WHERE id = $3 AND domain_id = $4 RETURNING *`,
    [status, now, id, domainId || null]
  );
  if ((result.rowCount ?? 0) === 0) {
    logger.warn(tApp("analysis.hot-card.analysis-report-hot-cards.208", { id: id }));
    return null;
  }
  logger.info(tApp("analysis.hot-card.analysis-report-hot-cards.209", { id: id, status: status }));
  return mapRow(result.rows[0]);
}

export async function updateCardBusinessDescription(
  id: string,
  businessDescription: string,
  domainId?: string
): Promise<AnalysisReportHotCard | null> {
  const pool = getPool();
  const now = Date.now();
  const result = await pool.query(
    `UPDATE ${qualifiedTable("analysis_report_hot_cards")}
     SET business_description = $1, updated_at = $2
     WHERE id = $3 AND domain_id = $4 RETURNING *`,
    [businessDescription, now, id, domainId || null]
  );
  if ((result.rowCount ?? 0) === 0) {
    logger.warn(tApp("analysis.hot-card.analysis-report-hot-cards.210", { id: id }));
    return null;
  }
  return mapRow(result.rows[0]);
}

export async function deleteCard(id: string, domainId?: string): Promise<boolean> {
  const pool = getPool();
  const result = await pool.query(
    `DELETE FROM ${qualifiedTable("analysis_report_hot_cards")}
     WHERE id = $1 AND domain_id = $2`,
    [id, domainId || null]
  );
  if ((result.rowCount ?? 0) > 0) {
    logger.info(tApp("analysis.hot-card.analysis-report-hot-cards.211", { id: id }));
    return true;
  }
  logger.warn(tApp("analysis.hot-card.analysis-report-hot-cards.212", { id: id }));
  return false;
}

export async function getPublishedCards(filter: {
  domainId: string | undefined;
  agentId?: string;
}): Promise<AnalysisReportHotCard[]> {
  return listCards({
    domainId: filter.domainId,
    status: "PUBLISHED",
    agentId: filter.agentId,
  });
}

export async function getPublishedCardCandidates(filter: {
  domainId: string | undefined;
  agentId?: string;
}): Promise<AnalysisReportHotCardMatchCandidate[]> {
  return listCards(
    { domainId: filter.domainId, status: "PUBLISHED", agentId: filter.agentId },
    { projection: "matchCandidate" }
  );
}

export async function listAgentHotReports(filter: {
  agentId: string;
  domainId?: string;
}): Promise<AnalysisReportHotCardSummary[]> {
  return listCards(
    { domainId: filter.domainId, agentId: filter.agentId, statuses: ["PUBLISHED", "UNUSED"] },
    { projection: "summary" }
  );
}

function mapRow(row: CardRow): AnalysisReportHotCard {
  return {
    id: row.id,
    question: row.question,
    dimensions: row.dimensions,
    reportContent: row.report_content || "",
    status: row.status as AnalysisReportHotCard["status"],
    businessDescription: row.business_description || "",
    agentId: row.agent_id || "",
    sessionId: row.session_id || "",
    createdAt: parseInt(row.created_at, 10),
    updatedAt: parseInt(row.updated_at, 10),
  };
}

function mapSummaryRow(row: CardSummaryRow): AnalysisReportHotCardSummary {
  return {
    id: row.id,
    question: row.question,
    status: row.status as AnalysisReportHotCard["status"],
    businessDescription: row.business_description || "",
    agentId: row.agent_id || "",
    dimensions: Array.isArray(row.dimension_names) ? row.dimension_names : [],
    questionTotal: Number(row.question_total || 0),
    createdAt: parseInt(row.created_at, 10),
    updatedAt: parseInt(row.updated_at, 10),
  };
}
