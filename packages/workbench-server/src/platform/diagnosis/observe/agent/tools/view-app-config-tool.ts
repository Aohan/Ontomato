import type { AgentTool } from "../../../../../core/agent-loop/index";
import { getApiConfig, buildUrl } from "../../../../../config/data-query-api";
import { backendGet } from "../../../../../utils/backend-client";
import { createLogger } from "../../../../../logging/logger";
import type { DiagnosisCallerIdentity } from "./caller-identity";
import { tApp } from "../../../../../i18n";


const logger = createLogger("observe:tool:view-app-config");

const ENDPOINT = "/businessConfig/getConfigAndDesc";

const MAX_VALUE_LENGTH = 500;
const MAX_DESC_LENGTH = 2000;

/**
 * Field-name patterns whose string values must be masked before returning the
 * config to the agent. Matched case-insensitively against the key, so e.g.
 * `apiKey`, `m3auth`, `accessToken`, `dbPassword`, `clientSecret` all hit.
 */
const SENSITIVE_KEY_PATTERN = /key|token|auth|password|secret/i;

/**
 * Mask a secret string the same way the settings route masks apiKey: replace
 * everything but the last 4 chars with `*`. Short values are fully masked.
 */
function maskSecret(value: string): string {
  if (!value) return value;
  if (value.length <= 4) return "*".repeat(value.length);
  return `${"*".repeat(value.length - 4)}${value.slice(-4)}`;
}

/**
 * Deep-clone the config tree, masking any string value whose field name looks
 * sensitive. Non-sensitive fields (url / namespace / model / enable ...) are
 * returned as-is. Only string leaves under a sensitive key are masked --
 * objects/arrays keep their structure so the agent can still see the shape.
 */
function sanitizeConfig(value: unknown, keyIsSensitive = false): unknown {
  if (value === null) return undefined;
  if (typeof value === "string") {
    return keyIsSensitive ? maskSecret(value) : value;
  }
  if (Array.isArray(value)) {
    // An array under a sensitive key propagates the flag to its string items.
    return value
      .map((item) => sanitizeConfig(item, keyIsSensitive))
      .filter((item) => item !== undefined);
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const sanitized = sanitizeConfig(v, SENSITIVE_KEY_PATTERN.test(k));
      if (sanitized !== undefined) {
        out[k] = sanitized;
      }
    }
    return out;
  }
  // numbers / booleans / undefined -- never sensitive on their own.
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function cleanInline(value: string): string {
  const oneLine = value.replace(/\r?\n/g, " ").trim();
  if (oneLine.length <= MAX_VALUE_LENGTH) return oneLine;
  return tApp("diag.observe.agent.tools.view-app-config-tool.0", { p0: oneLine.slice(0, MAX_VALUE_LENGTH) });
}

function cleanBlock(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= MAX_DESC_LENGTH) return trimmed;
  return tApp("diag.observe.agent.tools.view-app-config-tool.0", { p0: trimmed.slice(0, MAX_DESC_LENGTH) });
}

function formatScalar(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") return cleanInline(value || tApp("diag.observe.agent.tools.view-app-config-tool.1"));
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return cleanInline(JSON.stringify(value));
  } catch {
    return cleanInline(String(value));
  }
}

function appendFlattenedRows(value: unknown, prefix: string, rows: string[]): void {
  if (value === null || value === undefined) return;

  const label = prefix || "(value)";

  if (Array.isArray(value)) {
    if (value.length === 0) {
      rows.push(`- \`${label}\`: []`);
      return;
    }

    if (value.every((item) => !isRecord(item) && !Array.isArray(item))) {
      rows.push(`- \`${label}\`: ${value.map(formatScalar).join(", ")}`);
      return;
    }

    value.forEach((item, index) => {
      appendFlattenedRows(item, `${label}[${index}]`, rows);
    });
    return;
  }

  if (isRecord(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      rows.push(`- \`${label}\`: {}`);
      return;
    }
    for (const [key, child] of entries) {
      appendFlattenedRows(child, prefix ? `${prefix}.${key}` : key, rows);
    }
    return;
  }

  rows.push(`- \`${label}\`: ${formatScalar(value)}`);
}

function flattenRows(value: unknown): string[] {
  const rows: string[] = [];
  appendFlattenedRows(value, "", rows);
  return rows;
}

function formatDescription(desc: unknown): string[] {
  if (desc === undefined || desc === null || desc === "") return [];
  const lines = [tApp("diag.observe.agent.tools.view-app-config-tool.2")];
  if (typeof desc === "string") {
    lines.push(cleanBlock(desc));
    return lines;
  }

  const rows: string[] = [];
  appendFlattenedRows(sanitizeConfig(desc), "", rows);
  lines.push(...(rows.length > 0 ? rows : [tApp("diag.observe.agent.tools.view-app-config-tool.3")]));
  return lines;
}

function pickDescription(
  json: Record<string, unknown>,
  data: Record<string, unknown> | undefined
): unknown {
  const candidates = [data, json].filter(Boolean) as Record<string, unknown>[];
  const keys = ["desc", "description", "configDesc", "configDescription"];
  for (const source of candidates) {
    for (const key of keys) {
      if (source[key] !== undefined && source[key] !== null && source[key] !== "") {
        return source[key];
      }
    }
  }
  return undefined;
}

function pickSectionDescription(desc: unknown, section: string): unknown {
  if (!section || !isRecord(desc)) return desc;
  const candidates = [section, `${section}Desc`, `${section}Description`];
  for (const key of candidates) {
    if (desc[key] !== undefined && desc[key] !== null && desc[key] !== "") return desc[key];
  }
  return desc;
}

function formatKnownSectionGuide(value: unknown, hasDesc: boolean): string[] {
  if (!isRecord(value)) return [];

  const rows: string[] = [];
  if ("langchain4j" in value) {
    rows.push(tApp("diag.observe.agent.tools.view-app-config-tool.4"));
  }
  if ("ontomato" in value) {
    rows.push(tApp("diag.observe.agent.tools.view-app-config-tool.5"));
  }
  if (hasDesc) {
    rows.push(
      tApp("diag.observe.agent.tools.view-app-config-tool.6")
    );
  }

  return rows.length > 0 ? [tApp("diag.observe.agent.tools.view-app-config-tool.7"), ...rows] : [];
}

/** Render the config (already sanitized) as readable Markdown. */
function formatConfig(
  label: string,
  value: unknown,
  desc?: unknown,
  mode: "full" | "section" = "full"
): string {
  const lines = [`## ${label}`];

  const descLines = formatDescription(desc);
  if (descLines.length > 0) {
    lines.push("", ...descLines);
  }

  const sectionGuide = mode === "full" ? formatKnownSectionGuide(value, descLines.length > 0) : [];
  if (sectionGuide.length > 0) {
    lines.push("", ...sectionGuide);
  }

  if (mode === "full" && isRecord(value)) {
    const sections = Object.keys(value);
    lines.push("", tApp("diag.observe.agent.tools.view-app-config-tool.8"));
    lines.push(...(sections.length > 0 ? sections.map((key) => `- \`${key}\``) : [tApp("diag.observe.agent.tools.view-app-config-tool.9")]));

    for (const [section, sectionValue] of Object.entries(value)) {
      const rows: string[] = [];
      appendFlattenedRows(sectionValue, "", rows);
      lines.push("", `### ${section}`);
      lines.push(...(rows.length > 0 ? rows : [tApp("diag.observe.agent.tools.view-app-config-tool.10")]));
    }
  } else {
    const rows = flattenRows(value);
    lines.push("", tApp("diag.observe.agent.tools.view-app-config-tool.11"));
    lines.push(...(rows.length > 0 ? rows : [tApp("diag.observe.agent.tools.view-app-config-tool.10")]));
  }

  return lines.join("\n");
}

/**
 * Factory for the `view_app_config` tool. Reads the data engine's running
 * config via `/businessConfig/getConfigAndDesc` (same endpoint/method as
 * `backend-config-fetcher.fetchBackendConfig`), masks sensitive fields, includes
 * the backend-provided `desc` explanation when present, and optionally narrows
 * to a single top-level section. tk is read from the per-session holder at
 * execute time.
 */
export function createViewAppConfigTool(caller: DiagnosisCallerIdentity): AgentTool {
  return {
    name: "view_app_config",
    description:
      tApp("diag.observe.agent.tools.view-app-config-tool.12"),
    parameters: {
      type: "object",
      properties: {
        section: {
          type: "string",
          description:
            tApp("diag.observe.agent.tools.view-app-config-tool.13"),
        },
      },
    },
    async execute(_toolCallId, params) {
      const apiConfig = getApiConfig();
      if (!apiConfig.baseUrl) {
        return {
          content: [
            {
              type: "text",
              text: tApp("diag.observe.agent.tools.view-app-config-tool.15"),
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
        let json: Record<string, unknown> = {};
        try {
          json = JSON.parse(resp.text);
        } catch {
          /* Keep the existing invalid-JSON fallback. */
        }

        if (json.success === false) {
          return {
            content: [{ type: "text", text: tApp("diag.observe.agent.tools.view-app-config-tool.16") }],
          };
        }

        const data = json.data as Record<string, unknown> | undefined;
        const config = data?.config as Record<string, unknown> | undefined;
        const desc = pickDescription(json, data);
        if (!config || typeof config !== "object") {
          return {
            content: [{ type: "text", text: tApp("diag.observe.agent.tools.view-app-config-tool.17") }],
          };
        }

        const sectionParam = typeof params.section === "string" ? params.section.trim() : "";
        if (sectionParam) {
          if (!(sectionParam in config)) {
            const available = Object.keys(config).join(", ") || tApp("diag.observe.agent.tools.view-app-config-tool.18");
            return {
              content: [
                {
                  type: "text",
                  text: tApp("diag.observe.agent.tools.view-app-config-tool.19", { p0: sectionParam, p1: available }),
                },
              ],
            };
          }
          const sanitized = sanitizeConfig(config[sectionParam]);
          const sectionDesc = pickSectionDescription(desc, sectionParam);
          return {
            content: [
              {
                type: "text",
                text: formatConfig(tApp("diag.observe.agent.tools.view-app-config-tool.20", { p0: sectionParam }), sanitized, sectionDesc, "section"),
              },
            ],
          };
        }

        const sanitized = sanitizeConfig(config);
        return {
          content: [
            {
              type: "text",
              text: formatConfig(tApp("diag.observe.agent.tools.view-app-config-tool.21"), sanitized, desc),
            },
          ],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(tApp("diag.observe.agent.tools.view-app-config-tool.22"), err instanceof Error ? err : undefined);
        return {
          content: [{ type: "text", text: tApp("diag.observe.agent.tools.view-app-config-tool.23", { p0: msg }) }],
        };
      }
    },
  };
}
