import type { LocationQuery } from "vue-router";

/**
 * Where the governance page returns to: its entries (the Manager's knowledge page, the system agents page) pass their
 * admin path as the from query. The query is URL input, so only admin-internal paths are accepted; a missing or other
 * value (e.g. a directly opened link) returns to the system agents page.
 */
export function governanceReturnPath(query: LocationQuery): string {
  const from = query.from;
  return typeof from === "string" && from.startsWith("/admin/") ? from : "/admin/system-agents";
}
