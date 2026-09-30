import type pg from "pg";
import { getSchemaName } from "../postgres.js";

export type QueryableClient = Pick<pg.PoolClient, "query">;

export async function getTableColumns(
  client: QueryableClient,
  tableName: string
): Promise<Set<string>> {
  const result = await client.query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = $1 AND table_name = $2`,
    [getSchemaName(), tableName]
  );
  return new Set(result.rows.map((row: { column_name: string }) => row.column_name));
}

export function hasRequiredColumns(columns: Set<string>, required: string[]): boolean {
  return required.every((column) => columns.has(column));
}

export function queryRunIdSql(
  threadIdExpr: string,
  requestSeqExpr: string,
  sourceExpr: string
): string {
  return `'query:' || md5(${threadIdExpr} || ':' || ${requestSeqExpr}::text || ':' || ${sourceExpr})`;
}

export function integerJsonTextSql(textExpr: string): string {
  return `CASE
    WHEN ${textExpr} ~ '^[0-9]+$' THEN (${textExpr})::integer
    ELSE NULL::integer
  END`;
}

export function nullableColumn(
  columns: Set<string>,
  alias: string,
  column: string,
  fallback: string
): string {
  return columns.has(column) ? `${alias}.${escapeIdentifier(column)}` : fallback;
}

export function jsonColumn(columns: Set<string>, alias: string, column: string): string {
  return nullableColumn(columns, alias, column, "NULL::jsonb");
}

export function textColumn(
  columns: Set<string>,
  alias: string,
  column: string,
  fallback: string
): string {
  return nullableColumn(columns, alias, column, fallback);
}

export function numericColumn(
  columns: Set<string>,
  alias: string,
  column: string,
  fallback: string
): string {
  return nullableColumn(columns, alias, column, fallback);
}

export function timestampColumn(
  columns: Set<string>,
  alias: string,
  column: string,
  fallback = "NOW()"
): string {
  return nullableColumn(columns, alias, column, fallback);
}

export function datasetRowCountSql(datasetsExpr: string): string {
  return `(
    SELECT NULLIF(SUM(
      CASE
        WHEN jsonb_typeof(dataset.item->'data') = 'array' THEN jsonb_array_length(dataset.item->'data')
        WHEN jsonb_typeof(dataset.item->'rows') = 'array' THEN jsonb_array_length(dataset.item->'rows')
        WHEN jsonb_typeof(dataset.item->'result') = 'array' THEN jsonb_array_length(dataset.item->'result')
        ELSE 0
      END
    ), 0)::integer
    FROM jsonb_array_elements(
      CASE
        WHEN jsonb_typeof(${datasetsExpr}) = 'array' THEN ${datasetsExpr}
        ELSE '[]'::jsonb
      END
    ) AS dataset(item)
  )`;
}

function escapeIdentifier(id: string): string {
  return `"${id.replace(/"/g, '""')}"`;
}
