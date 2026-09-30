import type {
  SessionInfo as AgentSession,
  SessionContext,
} from "@ontomato/contracts/diagnosis";
import type { RouteLocationNormalizedLoaded } from "vue-router";
import { t } from "../../../i18n";

export function detectSessionContext(route: RouteLocationNormalizedLoaded): SessionContext {
  const path = route.path;
  const group = typeof route.meta.group === "string" ? route.meta.group : "";

  if (path.match(/^\/observe\/turn\/(.+)/)) {
    const turnKey = String(route.params.turnKey || "");
    return turnKey ? { page: "observe", targetKey: turnKey } : { page: "observe" };
  }

  if (path.match(/^\/observe\/autotest\/runs\/(.+)\/cases\/(.+)/)) {
    const runId = String(route.params.runId || "");
    const caseId = String(route.params.caseId || "");
    return runId && caseId
      ? { page: "autotest", targetKey: `${runId}/${caseId}` }
      : { page: "autotest" };
  }

  if (path === "/observe/results") {
    const rawRunId = route.query.runId;
    const runId = typeof rawRunId === "string" ? rawRunId : undefined;
    return runId ? { page: "autotest", targetKey: runId } : { page: "autotest" };
  }

  if (path === "/observe/cases") {
    return { page: "autotest" };
  }

  if (path === "/observe/test") {
    return { page: "autotest" };
  }

  if (group === "observe") {
    return { page: "observe" };
  }

  if (group === "autotest") {
    return { page: "autotest" };
  }

  return { page: "general" };
}

export function sessionContextFromSession(session?: AgentSession): SessionContext | undefined {
  if (!session) return undefined;
  if (session.context) return session.context;
  return undefined;
}

export function contextLabel(context?: SessionContext): string {
  if (!context) return "";
  if (context.page === "observe") {
    return context.targetKey ? `Turn: ${context.targetKey.slice(0, 18)}` : t("nav.observability");
  }
  if (context.page === "autotest") {
    return context.targetKey
      ? `${t("common.test")}: ${compactMiddle(context.targetKey, 18)}`
      : t("diagnosis.autoTest");
  }
  return t("diagnosis.general");
}

export function sessionContextLabel(session?: AgentSession): string {
  return contextLabel(sessionContextFromSession(session));
}

function compactMiddle(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  const keep = Math.max(4, Math.floor((maxLength - 3) / 2));
  return `${text.slice(0, keep)}...${text.slice(-keep)}`;
}
