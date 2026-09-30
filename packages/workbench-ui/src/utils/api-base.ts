/**
 * Unified API base prefix module.
 *
 * All frontend outlets (fetch / EventSource / download links) take their prefix from here,
 * instead of each page writing its own `/api` constant.
 *
 * At runtime it reads `window.__APP_CONFIG__?.API_BASE` (injected by the backend `/config.js`),
 * falling back to `/api` (usable in dev via vite proxy with zero config).
 *
 * When multiple instances are deployed under the same domain, each instance sets a different
 * `API_BASE` (e.g. `/api-itsm`), and nginx rewrites `/api-itsm/` back to the backend `/api/`.
 */

function resolveApiBase(): string {
  const raw = typeof window !== "undefined" ? window.__APP_CONFIG__?.API_BASE : undefined;
  const base = raw && raw.trim() ? raw.trim() : "/api";
  // Strip trailing slashes to avoid double slashes when concatenating.
  return base.replace(/\/+$/, "");
}

/** Normalized API prefix, e.g. `/api` or `/api-itsm` (no trailing slash). */
export const API_BASE = resolveApiBase();

/**
 * Concatenate the API prefix with a path. `path` automatically gets a leading slash.
 * For example `apiUrl("chat")` → `/api/chat`.
 */
export function apiUrl(path: string): string {
  if (!path) return API_BASE;
  const p = String(path);
  return `${API_BASE}${p.startsWith("/") ? p : `/${p}`}`;
}
