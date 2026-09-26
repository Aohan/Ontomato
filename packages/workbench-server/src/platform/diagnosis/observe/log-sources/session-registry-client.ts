/**
 * Session registry HTTP client.
 *
 * The registry stores one routing row per (backend session, datarag node): the
 * node that handled the request and the time window that should be used when
 * asking that node for runtime log slices. It does not provide backend log
 * content.
 *
 * Reads go through the datarag backend (`GET /observe/logs/session-registry`)
 * on the main backend API baseUrl, using the shared backend request channel so
 * caller credentials are forwarded. The response `data` is the session's full
 * routing-row array. A successful query without rows and a failed query are
 * kept apart: callers must be able to say which one happened
 * （问数后端会话的定位与取消·设计 7）.
 */

import { getApiConfig, buildUrl } from "../../../../config/data-query-api";
import { environment } from "../../../../config/environment";
import { backendGet } from "../../../../utils/backend-client";
import { createLogger } from "../../../../logging/logger";
import type { BackendNodeRequestOptions } from "./backend-node-client";
import { tApp } from "../../../../i18n";


const logger = createLogger("observe:session-registry");

const SESSION_REGISTRY_ENDPOINT = "/observe/logs/session-registry";

/** 路由表一行：一个后端会话在一个 datarag 节点上的执行窗口与取消时间。 */
export interface SessionRegistryRow {
  sessionId: string;
  nodeId: string;
  startTs?: number;
  endTs?: number;
  cancelledAt?: number;
}

/** 一次路由查询的结果：成功时给行（可为空），失败时给原因。 */
export interface SessionRegistryLookup {
  rows: SessionRegistryRow[];
  /** 查询失败的原因；查询成功（含该会话无行）时为 undefined */
  error?: string;
}

export async function lookupSessionRegistryRows(
  sessionId: string,
  options: BackendNodeRequestOptions = {}
): Promise<SessionRegistryLookup> {
  if (!sessionId) return { rows: [] };

  const apiConfig = getApiConfig();
  if (!apiConfig.baseUrl) {
    logger.warn("Backend API baseUrl not configured, skipping session registry lookup");
    return { rows: [], error: tApp("diag.observe.log-sources.session-registry-client.0") };
  }

  const url = `${buildUrl(apiConfig, SESSION_REGISTRY_ENDPOINT)}?sessionId=${encodeURIComponent(sessionId)}`;
  try {
    const resp = await backendGet(SESSION_REGISTRY_ENDPOINT, url, {
      token: options.token || environment.queryKey(),
      userId: options.userId,
      locale: options.locale,
      timeoutMs: options.timeoutMs ?? 60_000,
      retries: 1,
      signal: options.signal,
    });
    return parseRows(sessionId, resp.text);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.warn("Session registry lookup failed", { error: msg });
    return { rows: [], error: msg };
  }
}

function parseRows(sessionId: string, text: string): SessionRegistryLookup {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    logger.warn("Session registry response is not JSON");
    return { rows: [], error: tApp("diag.observe.log-sources.session-registry-client.1") };
  }
  if (!json || typeof json !== "object" || Array.isArray(json)) {
    logger.warn("Session registry response has unexpected shape");
    return { rows: [], error: tApp("diag.observe.log-sources.session-registry-client.2") };
  }
  const data = (json as Record<string, unknown>).data;
  if (!Array.isArray(data)) {
    logger.warn("Session registry response has unexpected data shape");
    return { rows: [], error: tApp("diag.observe.log-sources.session-registry-client.3") };
  }

  const rows: SessionRegistryRow[] = [];
  for (const item of data) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const fields = item as Record<string, unknown>;
    const nodeId = typeof fields.nodeId === "string" ? fields.nodeId.trim() : "";
    // 节点是路由行主键的一部分；没有节点的行无法定位，不当作证据单位。
    if (!nodeId) continue;

    const sessionIdField = fields.sessionId;
    const row: SessionRegistryRow = {
      sessionId: typeof sessionIdField === "string" && sessionIdField ? sessionIdField : sessionId,
      nodeId,
    };
    const startTs = finiteNumber(fields.startTs);
    if (startTs !== undefined) row.startTs = startTs;
    const endTs = finiteNumber(fields.endTs);
    if (endTs !== undefined) row.endTs = endTs;
    const cancelledAt = finiteNumber(fields.cancelledAt);
    if (cancelledAt !== undefined) row.cancelledAt = cancelledAt;
    rows.push(row);
  }
  return { rows };
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
