/** Fields a data adapter connection can have; which ones each adapter needs comes from its fields. */
export type DataAdapterField = "url" | "user" | "password";

/** A data adapter installed in this edition. */
export interface DataAdapterInfo {
  type: string;
  label: string;
  sql: boolean;
  fields: DataAdapterField[];
  /** Input examples (only for fields that have one), declared by the adapter module. */
  examples: Partial<Record<DataAdapterField, string>>;
}

/** `data` of GET /businessConfig/dataAdapters: the current domain's adapter type and the installed adapters, without saved connections. */
export interface DataAdaptersData {
  currentType: string;
  adapters: DataAdapterInfo[];
}
