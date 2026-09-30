import type { SessionContext } from "@ontomato/contracts/diagnosis";
import { getPostgresPool, qualifiedTable } from "../../../../infrastructure/postgres";

export interface DiagnosisSessionRow {
  id: string;
  title: string;
  context?: SessionContext;
  createdAt: string;
  responseStatus: "idle" | "running";
}

export const diagnosisSessions = {
  async insert(row: Omit<DiagnosisSessionRow, "responseStatus">): Promise<void> {
    await getPostgresPool().query(
      `INSERT INTO ${qualifiedTable("diagnosis_sessions")} (id, title, context, created_at)
       VALUES ($1, $2, $3::jsonb, $4)`,
      [row.id, row.title, row.context ? JSON.stringify(row.context) : null, row.createdAt]
    );
  },

  async list(): Promise<DiagnosisSessionRow[]> {
    const result = await getPostgresPool().query(
      `SELECT d.id, d.title, d.context, d.created_at AS "createdAt", h.status AS "responseStatus"
       FROM ${qualifiedTable("diagnosis_sessions")} d JOIN ${qualifiedTable("harness_sessions")} h ON h.id = d.id ORDER BY d.created_at DESC`
    );
    return result.rows.map(toRow);
  },

  async get(id: string): Promise<DiagnosisSessionRow | null> {
    const result = await getPostgresPool().query(
      `SELECT d.id, d.title, d.context, d.created_at AS "createdAt", h.status AS "responseStatus"
       FROM ${qualifiedTable("diagnosis_sessions")} d JOIN ${qualifiedTable("harness_sessions")} h ON h.id = d.id WHERE d.id = $1`,
      [id]
    );
    const row = result.rows[0];
    return row ? toRow(row) : null;
  },

  async delete(id: string): Promise<boolean> {
    const result = await getPostgresPool().query(
      `DELETE FROM ${qualifiedTable("diagnosis_sessions")} WHERE id = $1`,
      [id]
    );
    return (result.rowCount ?? 0) > 0;
  },
};

function toRow(row: {
  id: string;
  title: string;
  context: SessionContext | null;
  createdAt: Date | string;
  responseStatus: "idle" | "running";
}): DiagnosisSessionRow {
  return {
    id: row.id,
    title: row.title,
    responseStatus: row.responseStatus,
    createdAt: new Date(row.createdAt).toISOString(),
    ...(row.context ? { context: row.context } : {}),
  };
}
