import type { AgentTool } from "../../../../../core/agent-loop/index";
import { getApiConfig, buildUrl } from "../../../../../config/data-query-api";
import { backendGet } from "../../../../../utils/backend-client";
import { createLogger } from "../../../../../logging/logger";
import type { DiagnosisCallerIdentity } from "./caller-identity";
import { m3DiagnosticSupport } from "../../m3-support";
import { workbenchProduct } from "../../../../../product/installed";
import { tApp } from "../../../../../i18n";


const logger = createLogger("observe:tool:service-health");

const ENDPOINT = "/maintenance/getserviceinfo";

/** Cap the formatted output so a large status payload can't blow the context. */
const MAX_RESPONSE_LENGTH = 8000;

/**
 * Subset of the `SystemStatus` shape returned by `/maintenance/getserviceinfo`.
 * Structure mirrors the frontend interface in
 * `web/src/features/admin/components/platform-operations/SystemMonitor.vue` (lines 18-95). All fields are optional
 * here because the deployed maintenance service is outside this repo and we must
 * format whatever it sends without throwing.
 */
export interface ServiceItem {
  name?: string;
  status?: string;
  pid?: number;
  cpu_percent?: number;
  memory_mb?: number;
  uptime_seconds?: number;
}

interface DockerContainer {
  name?: string;
  image?: string;
  status?: string;
  cpu_percent?: number;
  memory_mb?: number;
  uptime_seconds?: number;
}

interface CpuInfo {
  userate?: number;
}

interface MemoryInfo {
  total_gb?: number;
  used_gb?: number;
  usage_percent?: number;
}

interface DiskInfo {
  partition?: string;
  usage_percent?: number;
}

interface ServerInfo {
  cpu?: CpuInfo;
  memory?: MemoryInfo;
  disk?: DiskInfo[];
}

export interface SystemStatus {
  hostname?: string;
  timestamp?: string;
  server?: ServerInfo;
  m3?: { services?: ServiceItem[] };
  backend?: { service?: ServiceItem };
  frontend?: { docker?: { containers?: DockerContainer[] } };
}

/** A flattened "one service" view used for uniform formatting. */
export interface FlatService {
  /** Which subsystem this entry belongs to. */
  group: string;
  name: string;
  status: string;
  isCritical: boolean;
  note?: string;
  pid?: number;
  cpu_percent?: number;
  memory_mb?: number;
  uptime_seconds?: number;
}

/**
 * The maintenance endpoint returns the `SystemStatus` object directly (see
 * `SystemMonitor.vue` `fetchStatus`: `status.value = data as SystemStatus`).
 * Some reverse-proxy setups still wrap it under `data`, so accept both shapes.
 */
function extractStatus(json: unknown): SystemStatus | null {
  if (!json || typeof json !== "object") return null;
  const obj = json as Record<string, unknown>;
  // Bare SystemStatus: any of the known top-level service keys present.
  // Only apps with M3 support assembled treat m3 as a known top-level service key (the enterprise's original behavior).
  if (
    "server" in obj ||
    (m3DiagnosticSupport() !== null && "m3" in obj) ||
    "backend" in obj ||
    "frontend" in obj
  ) {
    return obj as SystemStatus;
  }
  // Wrapped under data envelope.
  const data = obj.data;
  if (data && typeof data === "object") {
    return data as SystemStatus;
  }
  return null;
}

function isRunning(status: string): boolean {
  return status.toLowerCase() === "running";
}

/** Map the raw status token to the same Chinese label the SystemMonitor UI shows. */
function statusLabel(status: string): string {
  const s = status.toLowerCase();
  if (s === "running") return tApp("diag.observe.agent.tools.service-health-tool.0");
  if (s === "stopping") return tApp("diag.observe.agent.tools.service-health-tool.1");
  if (s === "stopped") return tApp("diag.observe.agent.tools.service-health-tool.2");
  return status || tApp("diag.observe.agent.tools.service-health-tool.3");
}

function formatUptime(seconds?: number): string {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) return "";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatMemory(mb?: number): string {
  if (typeof mb !== "number" || !Number.isFinite(mb) || mb <= 0) return "";
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)}GB`;
  return `${Math.round(mb)}MB`;
}

/** Builds the per-service metric tail, e.g. `(pid 123, CPU 4.2%, mem 512MB, up 2h 5m)`. */
function metricTail(svc: FlatService): string {
  const parts: string[] = [];
  if (typeof svc.pid === "number" && svc.pid > 0) parts.push(`pid ${svc.pid}`);
  if (typeof svc.cpu_percent === "number" && Number.isFinite(svc.cpu_percent)) {
    parts.push(`CPU ${svc.cpu_percent}%`);
  }
  const mem = formatMemory(svc.memory_mb);
  if (mem) parts.push(tApp("diag.observe.agent.tools.service-health-tool.4", { p0: mem }));
  const uptime = formatUptime(svc.uptime_seconds);
  if (uptime) parts.push(tApp("diag.observe.agent.tools.service-health-tool.5", { p0: uptime }));
  return parts.length > 0 ? tApp("diag.observe.agent.tools.service-health-tool.6", { p0: parts.join(", ") }) : "";
}

/** Flatten the nested SystemStatus into a single list of services for formatting. */
function flattenServices(status: SystemStatus): FlatService[] {
  const out: FlatService[] = [];

  const names = workbenchProduct().serviceHealthNames;
  const pushItem = (group: string, item: ServiceItem | undefined, defaultName: string) => {
    if (!item) return;
    out.push({
      group,
      name: item.name || defaultName,
      status: item.status || "unknown",
      isCritical: true,
      pid: item.pid,
      cpu_percent: item.cpu_percent,
      memory_mb: item.memory_mb,
      uptime_seconds: item.uptime_seconds,
    });
  };

  out.push(...(m3DiagnosticSupport()?.serviceHealth.services(status) ?? []));
  pushItem(names.backendGroup, status.backend?.service, names.backendDefault);
  for (const c of status.frontend?.docker?.containers ?? []) {
    out.push({
      group: names.frontendGroup,
      name: c.name || names.frontendDefault,
      status: c.status || "unknown",
      isCritical: true,
      cpu_percent: c.cpu_percent,
      memory_mb: c.memory_mb,
      uptime_seconds: c.uptime_seconds,
    });
  }

  return out;
}

/** Render the server resource one-liner from `status.server`, if present. */
function formatServerResource(server?: ServerInfo): string {
  if (!server) return "";
  const parts: string[] = [];
  const cpuRate = server.cpu?.userate;
  if (typeof cpuRate === "number" && Number.isFinite(cpuRate)) {
    parts.push(tApp("diag.observe.agent.tools.service-health-tool.7", { p0: cpuRate }));
  }
  const mem = server.memory;
  if (mem && typeof mem.usage_percent === "number") {
    const detail =
      typeof mem.used_gb === "number" && typeof mem.total_gb === "number"
        ? ` (${mem.used_gb}/${mem.total_gb}GB)`
        : "";
    parts.push(tApp("diag.observe.agent.tools.service-health-tool.8", { p0: mem.usage_percent, p1: detail }));
  }
  const disks = (server.disk ?? []).filter(
    (d): d is DiskInfo => !!d && typeof d.usage_percent === "number"
  );
  if (disks.length > 0) {
    const diskStr = disks.map((d) => `${d.partition || tApp("diag.observe.agent.tools.service-health-tool.9")} ${d.usage_percent}%`).join(", ");
    parts.push(tApp("diag.observe.agent.tools.service-health-tool.10", { p0: diskStr }));
  }
  return parts.length > 0 ? parts.join(" | ") : "";
}

/** Compose the final human-readable report, highlighting any non-running service. */
function formatReport(status: SystemStatus): string {
  const support = m3DiagnosticSupport();
  const services = flattenServices(status);

  if (services.length === 0) {
    return tApp("diag.observe.agent.tools.service-health-tool.11");
  }

  const downCritical = services.filter((s) => s.isCritical && !isRunning(s.status));
  const downUnused = services.filter((s) => !s.isCritical && !isRunning(s.status));
  const lines: string[] = [];

  const header = status.hostname ? tApp("diag.observe.agent.tools.service-health-tool.12", { p0: status.hostname }) : tApp("diag.observe.agent.tools.service-health-tool.13");
  lines.push(`# ${header}`);

  // Lead with the verdict so the agent can react fast.
  if (downCritical.length === 0) {
    lines.push(tApp("diag.observe.agent.tools.service-health-tool.14"));
    if (downUnused.length > 0 && support) {
      const health = support.serviceHealth;
      lines.push(health.unusedDownIntro(downUnused.length));
      for (const s of downUnused) {
        lines.push(health.unusedDownItem(s.group, s.name, statusLabel(s.status)));
      }
    }
  } else {
    lines.push(tApp("diag.observe.agent.tools.service-health-tool.15", { p0: downCritical.length, p1: services.length }));
    for (const s of downCritical) {
      lines.push(`- [${s.group}] ${s.name} — ${statusLabel(s.status)}`);
    }
    if (downUnused.length > 0 && support) {
      const health = support.serviceHealth;
      lines.push(health.unusedDownAlso(downUnused.length));
      for (const s of downUnused) {
        lines.push(health.unusedDownItem(s.group, s.name, statusLabel(s.status)));
      }
    }
  }

  const m3Note = support?.serviceHealth.summaryNote;
  if (m3Note) lines.push(m3Note);

  // Group the full per-service listing by subsystem.
  lines.push(tApp("diag.observe.agent.tools.service-health-tool.details"));
  const groups = new Map<string, FlatService[]>();
  for (const s of services) {
    const arr = groups.get(s.group) ?? [];
    arr.push(s);
    groups.set(s.group, arr);
  }
  for (const [group, items] of groups) {
    lines.push(`\n### ${group}`);
    for (const s of items) {
      let flag = "";
      if (!isRunning(s.status)) {
        if (s.isCritical) flag = " ⚠️";
        else if (support) flag = support.serviceHealth.unusedDetailMark;
      }
      const note = s.note && support ? `${support.serviceHealth.noteSeparator}${s.note}` : "";
      lines.push(`- ${s.name}: ${statusLabel(s.status)}${flag} ${metricTail(s)}${note}`.trimEnd());
    }
  }

  const serverLine = formatServerResource(status.server);
  if (serverLine) {
    lines.push(tApp("diag.observe.agent.tools.service-health-tool.16", { p0: serverLine }));
  }

  let body = lines.join("\n");
  if (body.length > MAX_RESPONSE_LENGTH) {
    body = tApp("diag.observe.agent.tools.service-health-tool.17", { p0: body.slice(0, MAX_RESPONSE_LENGTH) });
  }
  return body;
}

/**
 * Factory for the `service_health` tool. Probes the deployment's service status
 * via `GET /maintenance/getserviceinfo` (datarag baseUrl + tk, same pattern as
 * `view_app_config`) and returns which subsystems are running, highlighting
 * critical services that are stopped, plus a server-resource overview.
 * Non-critical M3 wording comes from the installed provider; a null install
 * does not list those services. tk is read from the
 * per-session holder at execute time. Read-only: never starts/stops services.
 */
export function createServiceHealthTool(caller: DiagnosisCallerIdentity): AgentTool {
  return {
    name: "service_health",
    description:
      tApp("diag.observe.agent.tools.service-health-tool.18"),
    parameters: {
      type: "object",
      properties: {},
    },
    async execute() {
      const apiConfig = getApiConfig();
      if (!apiConfig.baseUrl) {
        return {
          content: [
            {
              type: "text",
              text: tApp("diag.observe.agent.tools.service-health-tool.20"),
            },
          ],
        };
      }

      try {
        const url = buildUrl(apiConfig, ENDPOINT);
        const resp = await backendGet(ENDPOINT, url, {
          token: caller.token,
          apiKey: caller.apiKey,
          timeoutMs: 15_000,
          retries: 1,
        });
        let json: unknown = {};
        try {
          json = JSON.parse(resp.text);
        } catch {
          /* Keep the existing invalid-JSON fallback. */
        }

        if (
          json &&
          typeof json === "object" &&
          (json as Record<string, unknown>).success === false
        ) {
          return {
            content: [{ type: "text", text: tApp("diag.observe.agent.tools.service-health-tool.21") }],
          };
        }

        const status = extractStatus(json);
        if (!status) {
          return {
            content: [
              { type: "text", text: tApp("diag.observe.agent.tools.service-health-tool.22") },
            ],
          };
        }

        return {
          content: [{ type: "text", text: formatReport(status) }],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(tApp("diag.observe.agent.tools.service-health-tool.23"), err instanceof Error ? err : undefined);
        return {
          content: [{ type: "text", text: tApp("diag.observe.agent.tools.service-health-tool.24", { p0: msg }) }],
        };
      }
    },
  };
}
