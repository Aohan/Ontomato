import { diagnosticConfigResponseSchema } from "@ontomato/contracts/diagnostic-config";
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

function formatDescription(desc: string): string[] {
  return [tApp("diag.observe.agent.tools.view-app-config-tool.2"), cleanBlock(desc)];
}

/** The sections Java's diagnosis view always has, plus what `data.desc` is. */
function formatKnownSectionGuide(): string[] {
  return [
    tApp("diag.observe.agent.tools.view-app-config-tool.7"),
    tApp("diag.observe.agent.tools.view-app-config-tool.4"),
    tApp("diag.observe.agent.tools.view-app-config-tool.5"),
    tApp("diag.observe.agent.tools.view-app-config-tool.6"),
  ];
}

/** Render the diagnosis view as readable Markdown. */
function formatConfig(
  label: string,
  value: unknown,
  desc: string,
  mode: "full" | "section" = "full"
): string {
  const lines = [`## ${label}`];

  lines.push("", ...formatDescription(desc));
  if (mode === "full") {
    lines.push("", ...formatKnownSectionGuide());
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
 * diagnosis view via `/businessConfig/getConfigAndDesc`, which Java builds from
 * named non-secret fields only, includes the backend-provided `desc` explanation, and optionally narrows
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
        // errorDetailLimit 0: an HTTP error keeps only its status, never a fragment of the response body.
        const resp = await backendGet(ENDPOINT, url, {
          token: caller.token,
          apiKey: caller.apiKey,
          timeoutMs: 15_000,
          retries: 1,
          errorDetailLimit: 0,
        });
        // Only the contract's named fields pass; a body that is not that contract (malformed JSON included) is
        // reported as such without echoing any of it.
        let body: unknown;
        try {
          body = JSON.parse(resp.text);
        } catch {
          body = undefined;
        }
        const parsed = diagnosticConfigResponseSchema.safeParse(body);
        if (!parsed.success) {
          return {
            content: [{ type: "text", text: tApp("diag.observe.agent.tools.view-app-config-tool.17") }],
          };
        }
        if (!parsed.data.success) {
          return {
            content: [{ type: "text", text: tApp("diag.observe.agent.tools.view-app-config-tool.16") }],
          };
        }

        const { config, desc } = parsed.data.data;

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
          return {
            content: [
              {
                type: "text",
                text: formatConfig(tApp("diag.observe.agent.tools.view-app-config-tool.20", { p0: sectionParam }), config[sectionParam as keyof typeof config], desc, "section"),
              },
            ],
          };
        }

        return {
          content: [
            {
              type: "text",
              text: formatConfig(tApp("diag.observe.agent.tools.view-app-config-tool.21"), config, desc),
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
