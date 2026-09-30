const SERVER_NOW_HEADER = "x-server-now";

let syncedServerNow: number | null = null;
let syncedPerformanceNow = 0;

function getMonotonicNow(): number {
  if (typeof globalThis.performance?.now === "function") {
    return globalThis.performance.now();
  }
  return Date.now();
}

function parseServerNow(value?: string | number | null): number | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;

  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric;

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

export function syncServerNow(value?: string | number | null, receivedAt = getMonotonicNow()) {
  const parsed = parseServerNow(value);
  if (parsed === null) return false;
  syncedServerNow = parsed;
  syncedPerformanceNow = receivedAt;
  return true;
}

export function syncServerNowFromResponse(response: Response): boolean {
  return syncServerNow(response.headers.get(SERVER_NOW_HEADER) || response.headers.get("date"));
}

export function getSynchronizedNow(now = getMonotonicNow()): number {
  if (syncedServerNow === null) return Date.now();
  return syncedServerNow + (now - syncedPerformanceNow);
}

export function resetServerNowSync() {
  syncedServerNow = null;
  syncedPerformanceNow = 0;
}
