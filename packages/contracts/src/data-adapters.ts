import { z } from "zod";

/** Fields a data adapter connection can have; which ones each adapter needs comes from its fields. */
export type DataAdapterField = "url" | "company" | "user" | "password";

/** A data adapter installed in this edition. */
export interface DataAdapterInfo {
  type: string;
  label: string;
  /** Whether relations name the source and target join fields (fromField/toField) the adapter joins on; false for native graph relations. */
  requiresJoinFields: boolean;
  fields: DataAdapterField[];
  /** Input examples (only for fields that have one), declared by the adapter module. */
  examples: Partial<Record<DataAdapterField, string>>;
}

/** `data` of GET /businessConfig/dataAdapters: the current domain's adapter type and the installed adapters, without saved connections. */
export interface DataAdaptersData {
  currentType: string;
  adapters: DataAdapterInfo[];
}

const tableSchema = z.object({ name: z.string(), type: z.enum(["TABLE", "VIEW"]) });

/**
 * `data` of a successful POST /businessConfig/testDataAdapter, told apart by `kind`: a JDBC-style catalog report
 * (driver, catalog/schema and tables and views), or a search engine report (cluster and the indices visible to the
 * tested credentials). Parsed where the response is consumed, so a malformed report is a failure, not an empty catalog.
 */
export const dataAdapterTestResultSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("catalog"),
    elapsedMs: z.number(),
    databaseProduct: z.string(),
    databaseVersion: z.string(),
    driverName: z.string(),
    driverVersion: z.string(),
    catalog: z.string().nullable(),
    schema: z.string().nullable(),
    tables: z.array(tableSchema),
  }),
  z.object({
    kind: z.literal("search"),
    elapsedMs: z.number(),
    databaseProduct: z.string(),
    databaseVersion: z.string().nullable(),
    clusterName: z.string().nullable(),
    indices: z.array(z.string()),
  }),
]);

export type DataAdapterTestResult = z.infer<typeof dataAdapterTestResultSchema>;
