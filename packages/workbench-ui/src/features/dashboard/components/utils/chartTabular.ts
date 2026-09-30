type TableRow = Record<string, unknown>;

export function safeCloneOption<T>(option: T): T {
  if (!option || typeof option !== "object") return option;
  try {
    return structuredClone(option);
  } catch {
    try {
      return JSON.parse(JSON.stringify(option));
    } catch {
      return option;
    }
  }
}

export function extractTabularDataFromOption(list: unknown[]) {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const row of list) {
    const obj: TableRow = row && typeof row === "object" ? (row as TableRow) : {};
    for (const k of Object.keys(obj)) {
      if (seen.has(k)) continue;
      seen.add(k);
      keys.push(k);
    }
  }
  const maxRows = Math.min(list.length, 200);
  const body = list
    .slice(0, maxRows)
    .map((it: unknown) =>
      keys.map((k) => (it && typeof it === "object" ? ((it as TableRow)[k] ?? "") : ""))
    );

  if (Array.isArray(keys)) {
    const headers = keys.map((v) => String(v ?? ""));
    const rows = body;
    return { headers, rows };
  }
  return null;
}

export function formatCellValue(val: unknown) {
  if (val == null) return "";
  if (typeof val === "number") return Number.isInteger(val) ? String(val) : Number(val).toFixed(2);
  if (typeof val === "string" && val) {
    const n = Number(val);
    if (Number.isFinite(n)) return Number.isInteger(n) ? String(n) : n.toFixed(2);
    return val;
  }
  if (typeof val === "object") return JSON.stringify(val);
  return String(val);
}
