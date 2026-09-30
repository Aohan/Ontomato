/** Sampled column types; unknown means the samples contain no decidable non-null value. */
type ColumnType = "number" | "date" | "string" | "unknown";

interface ColumnProfile {
  name: string;
  type: ColumnType;
  distinct: number;
  examples: string[];
  /** Only for numeric columns */
  min?: number;
  max?: number;
  sum?: number;
}

export interface TableProfile {
  rowCount: number;
  columns: ColumnProfile[];
}

type Row = Record<string, unknown>;

function isNumberLike(v: unknown): boolean {
  if (typeof v === "number") return Number.isFinite(v);
  if (typeof v !== "string") return false;
  const s = v.trim();
  if (!s) return false;
  return Number.isFinite(Number(s));
}

function toNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function guessTypeFromSamples(samples: unknown[]): ColumnType {
  const arr = samples.filter((v) => v !== null && v !== undefined);
  if (arr.length === 0) return "unknown";
  // Simple date-like detection (can be enhanced later)
  const dateHits = arr.filter(
    (v) => typeof v === "string" && /^\d{4}-\d{1,2}-\d{1,2}/.test(v.trim())
  ).length;
  if (dateHits >= Math.max(2, Math.floor(arr.length * 0.6))) return "date";
  const numHits = arr.filter(isNumberLike).length;
  if (numHits >= Math.max(2, Math.floor(arr.length * 0.6))) return "number";
  return "string";
}

export function buildTableProfile(rows: unknown, opts: { maxProfileRows: number }): TableProfile {
  const list: Row[] = Array.isArray(rows)
    ? (rows.filter((r) => r && typeof r === "object") as Row[])
    : [];
  const rowCount = list.length;

  // Sampling cap is required: when omitted, Number(undefined) yields NaN, and slice(0, NaN) would empty the samples,
  // so rather than falling back here, let the type disallow not passing it.
  const maxProfileRows = Math.max(1, Math.min(200, opts.maxProfileRows));
  const sampleRows = list.slice(0, maxProfileRows);

  const colSet = new Set<string>();
  for (const r of sampleRows) for (const k of Object.keys(r)) colSet.add(k);
  const columns = Array.from(colSet);

  const colProfiles = columns.map((name): ColumnProfile => {
    const samples = sampleRows.map((r) => r?.[name]);
    const type = guessTypeFromSamples(samples);

    const distinctSet = new Set<string>();
    const examples: string[] = [];
    for (const v of samples) {
      const key = v == null ? "" : String(v);
      if (!distinctSet.has(key)) {
        distinctSet.add(key);
        if (examples.length < 5) examples.push(key);
      }
      if (distinctSet.size > 50) break;
    }

    const profile: ColumnProfile = { name, type, distinct: distinctSet.size, examples };

    if (type === "number") {
      const nums = samples
        .map(toNumber)
        .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
      if (nums.length) {
        let min = nums[0];
        let max = nums[0];
        let sum = 0;
        for (const n of nums) {
          if (n < min) min = n;
          if (n > max) max = n;
          sum += n;
        }
        profile.min = min;
        profile.max = max;
        profile.sum = sum;
      }
    }

    return profile;
  });

  return { rowCount, columns: colProfiles };
}

export function stableJsonStringify(obj: unknown): string | undefined {
  // Lightweight stable serialization: keys sorted
  if (obj === null || typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) return `[${obj.map(stableJsonStringify).join(",")}]`;
  const record = obj as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableJsonStringify(record[k])}`).join(",")}}`;
}

export function hashString(s: unknown): string {
  // Simple hash (good enough for frontend caching)
  const str = String(s || "");
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}
