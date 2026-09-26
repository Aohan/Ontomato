import type {
  DashboardDetail,
  DashboardGroup,
  DashboardListItem,
} from "@ontomato/contracts/dashboard";
import { randomUUID } from "node:crypto";
import { t, tApp } from "../../i18n";
import pg from "pg";

import { createLogger } from "../../logging/logger";

import { getPostgresPool, qualifiedTable } from "../../infrastructure/postgres";

const logger = createLogger("dashboard-store");

function getPool(): pg.Pool {
  return getPostgresPool();
}

function ensureGroups(groups: DashboardGroup[] | undefined): DashboardGroup[] {
  return (Array.isArray(groups) ? groups : []).map((group) => ({
    id: String(group?.id || randomUUID()),
    title: String(group?.title || "").trim(),
    charts: Array.isArray(group?.charts)
      ? group.charts.map((chart) => ({
          ...chart,
          id: String(chart?.id || randomUUID()),
          name: String(chart?.name || "").trim(),
          chartType: String(chart?.chartType || "bar"),
          dsl:
            chart?.dsl && typeof chart.dsl === "object" && !Array.isArray(chart.dsl)
              ? chart.dsl
              : {},
        }))
      : [],
    metrics: Array.isArray(group?.metrics)
      ? group.metrics.map((metric) => ({
          ...metric,
          id: String(metric?.id || randomUUID()),
          name: String(metric?.name || "").trim(),
          dsl:
            metric?.dsl && typeof metric.dsl === "object" && !Array.isArray(metric.dsl)
              ? metric.dsl
              : {},
        }))
      : [],
  }));
}

export async function listDashboards(
  ownerId: string,
  domainId: string
): Promise<DashboardListItem[]> {
  const pool = getPool();
  const result = await pool.query(
    `SELECT id, name, created_at, updated_at
     FROM ${qualifiedTable("dashboards")}
     WHERE owner_id = $1 AND domain_id = $2
     ORDER BY updated_at DESC`,
    [ownerId, domainId]
  );
  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    createdAt: parseInt(row.created_at, 10),
    updatedAt: parseInt(row.updated_at, 10),
  }));
}

export async function getDashboard(
  ownerId: string,
  domainId: string,
  id: string
): Promise<DashboardDetail | null> {
  const pool = getPool();
  const result = await pool.query(
    `SELECT * FROM ${qualifiedTable("dashboards")} WHERE owner_id = $1 AND id = $2 AND domain_id = $3`,
    [ownerId, id, domainId]
  );
  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  const detail: DashboardDetail = {
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    source: row.source,
    groups: ensureGroups(row.groups),
    createdAt: parseInt(row.created_at, 10),
    updatedAt: parseInt(row.updated_at, 10),
  };

  const normalizedGroups = JSON.stringify(detail.groups);
  if (normalizedGroups !== JSON.stringify(row.groups)) {
    await pool.query(
      `UPDATE ${qualifiedTable("dashboards")}
       SET groups = $1, updated_at = $2
       WHERE owner_id = $3 AND id = $4 AND domain_id = $5`,
      [JSON.stringify(detail.groups), Date.now(), ownerId, id, domainId]
    );
  }

  return detail;
}

export async function createDashboard(params: {
  ownerId: string;
  domainId: string;
  name: string;
  source?: DashboardDetail["source"];
  groups?: DashboardGroup[];
  id?: string;
}) {
  const pool = getPool();
  const now = Date.now();
  const detail: DashboardDetail = {
    id: String(params.id || randomUUID()),
    ownerId: params.ownerId,
    name: String(params.name || "").trim() || tApp("queryFixed.175"),
    createdAt: now,
    updatedAt: now,
    groups: ensureGroups(params.groups),
  };
  if (params.source) {
    detail.source = params.source;
  }
  await pool.query(
    `INSERT INTO ${qualifiedTable("dashboards")}
     (id, owner_id, name, source, groups, created_at, updated_at, domain_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      detail.id,
      params.ownerId,
      detail.name,
      params.source ? JSON.stringify(params.source) : null,
      JSON.stringify(detail.groups),
      now,
      now,
      params.domainId,
    ]
  );
  logger.info(tApp("queryFixed.176"), { ownerId: params.ownerId, dashboardId: detail.id });
  return detail;
}

export async function saveDashboard(ownerId: string, domainId: string, detail: DashboardDetail) {
  const pool = getPool();
  detail.updatedAt = Date.now();
  detail.groups = ensureGroups(detail.groups);
  const result = await pool.query(
    `UPDATE ${qualifiedTable("dashboards")}
     SET name = $1, groups = $2, source = $3, updated_at = $4
     WHERE owner_id = $5 AND id = $6 AND domain_id = $7`,
    [
      detail.name,
      JSON.stringify(detail.groups),
      detail.source ? JSON.stringify(detail.source) : null,
      detail.updatedAt,
      ownerId,
      detail.id,
      domainId,
    ]
  );
  if ((result.rowCount ?? 0) === 0) {
    throw new Error(t("dashboard.notFoundOrNoPerm"));
  }
}

export async function deleteDashboard(ownerId: string, domainId: string, id: string) {
  const pool = getPool();
  await pool.query(
    `DELETE FROM ${qualifiedTable("dashboards")} WHERE owner_id = $1 AND id = $2 AND domain_id = $3`,
    [ownerId, id, domainId]
  );
}
