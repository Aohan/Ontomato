import type { SessionContext, SessionContextPage } from "@ontomato/contracts/diagnosis";

export const SESSION_CONTEXT_PAGES = ["observe", "autotest", "general"] as const;

export function normalizeSessionContext(value: unknown): SessionContext | undefined {
  if (!value || typeof value !== "object") return undefined;

  const raw = value as Record<string, unknown>;
  const keys = Object.keys(raw);
  if (keys.some((key) => key !== "page" && key !== "targetKey")) return undefined;

  const page = typeof raw.page === "string" ? raw.page : "";
  if (!(SESSION_CONTEXT_PAGES as readonly string[]).includes(page)) return undefined;

  const context: SessionContext = { page: page as SessionContextPage };
  if (typeof raw.targetKey === "string" && raw.targetKey) context.targetKey = raw.targetKey;
  return context;
}
