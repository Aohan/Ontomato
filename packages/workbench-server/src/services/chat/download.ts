export function sanitizeDownloadName(name: string, fallback: string): string {
  const clean = String(name || "")
    .replace(/[\r\n]/g, " ")
    .replace(/[\\/:*?"<>|]/g, "")
    .trim()
    .slice(0, 40);
  return clean || fallback;
}

export function convertRowsToCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "";

  const headers = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  const escapeCell = (value: unknown) => {
    const text =
      value == null
        ? ""
        : typeof value === "string"
          ? value
          : (() => {
              try {
                return JSON.stringify(value);
              } catch {
                return String(value);
              }
            })();
    const escaped = text.replace(/"/g, '""');
    return /[",\n]/.test(escaped) ? `"${escaped}"` : escaped;
  };

  const lines = [headers.map(escapeCell).join(",")];
  for (const row of rows) {
    lines.push(headers.map((header) => escapeCell(row[header])).join(","));
  }
  return lines.join("\n");
}
