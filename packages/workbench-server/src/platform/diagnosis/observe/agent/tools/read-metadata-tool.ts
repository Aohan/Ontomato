import type { AgentTool } from "../../../../../core/agent-loop/index";
import { getApiConfig, buildUrl } from "../../../../../config/data-query-api";
import { backendGet, backendPost } from "../../../../../utils/backend-client";
import { createLogger } from "../../../../../logging/logger";
import type { DiagnosisCallerIdentity } from "./caller-identity";
import { tApp } from "../../../../../i18n";


const logger = createLogger("observe:tool:read-metadata");

const JSON_RULE_ENDPOINT = "/admin/getSchema";
const SCHEMA_MARKDOWN_ENDPOINT = "/admin/getschemamarkdown-v2";

/** Cap formatted metadata so a large ontology can't blow the context. */
const MAX_METADATA_LENGTH = 12_000;

type MetadataFormat = "json" | "markdown";

/** Unwrap the `data` envelope if present, otherwise use the body as-is. */
function unwrap(json: unknown): Record<string, unknown> {
  const obj = (json ?? {}) as Record<string, unknown>;
  const data = obj.data;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    return data as Record<string, unknown>;
  }
  return obj;
}

function parseFormat(value: unknown): MetadataFormat {
  if (typeof value !== "string") return "json";
  const normalized = value.trim().toLowerCase();
  if (normalized === "markdown" || normalized === "md") return "markdown";
  return "json";
}

function truncateMetadata(text: string): string {
  if (text.length <= MAX_METADATA_LENGTH) return text;
  return tApp("diag.observe.agent.tools.read-metadata-tool.0", { p0: text.slice(0, MAX_METADATA_LENGTH) });
}

/** Stringify JSONRule as plain JSON text and truncate if oversized. */
function formatJsonRule(data: Record<string, unknown>): string {
  let body: string;
  try {
    body = JSON.stringify(data, null, 2);
  } catch {
    body = String(data);
  }
  return truncateMetadata(body);
}

function pickFirstString(data: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function formatMarkdownSchema(json: unknown): string {
  const data = unwrap(json);
  if (typeof json === "string") return truncateMetadata(json);

  const directMarkdown = pickFirstString(data, [
    "markdown",
    "md",
    "schemaMarkdown",
    "schema_markdown",
    "content",
    "text",
  ]);
  if (directMarkdown) return truncateMetadata(directMarkdown);

  const datasetDesc = pickFirstString(data, ["KEY_DATASET_DESC", "datasetDesc", "dataset_desc"]);
  const classDef = pickFirstString(data, ["KEY_CLASS_DEF", "classDef", "class_def"]);
  const relationshipDef = pickFirstString(data, [
    "KEY_RELATIONSHIP_DEF",
    "relationshipDef",
    "relationship_def",
  ]);
  const relationshipChain = pickFirstString(data, [
    "KEY_RELATIONSHIP_CHAIN",
    "relationshipChain",
    "relationship_chain",
  ]);

  const parts: string[] = [];
  if (datasetDesc) parts.push(tApp("diag.observe.agent.tools.read-metadata-tool.1", { p0: datasetDesc }));
  if (classDef) parts.push(tApp("diag.observe.agent.tools.read-metadata-tool.2", { p0: classDef }));
  if (relationshipDef) parts.push(tApp("diag.observe.agent.tools.read-metadata-tool.3", { p0: relationshipDef }));
  if (relationshipChain) parts.push(relationshipChain);

  return truncateMetadata(parts.join("\n\n"));
}

function hasJsonRule(data: Record<string, unknown>): boolean {
  return data.classDefs !== undefined || data.relationshipDefs !== undefined;
}

/**
 * Factory for the `read_metadata` tool. Reads datarag metadata in two forms:
 * JSONRule (`GET /admin/getSchema`, default) and dataset schema Markdown
 * (`POST /admin/getschemamarkdown-v2`). tk is read from the per-session holder at
 * execute time.
 */
export function createReadMetadataTool(caller: DiagnosisCallerIdentity): AgentTool {
  return {
    name: "read_metadata",
    description:
      tApp("diag.observe.agent.tools.read-metadata-tool.4"),
    parameters: {
      type: "object",
      properties: {
        format: {
          type: "string",
          enum: ["json", "markdown", "md"],
          description:
            tApp("diag.observe.agent.tools.read-metadata-tool.5"),
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
              text: tApp("diag.observe.agent.tools.read-metadata-tool.7"),
            },
          ],
        };
      }

      try {
        const format = parseFormat(params?.format);
        const endpoint = format === "json" ? JSON_RULE_ENDPOINT : SCHEMA_MARKDOWN_ENDPOINT;
        const url = buildUrl(apiConfig, endpoint);
        const resp =
          format === "json"
            ? await backendGet(endpoint, url, {
                token: caller.token,
                apiKey: caller.apiKey,
                timeoutMs: 15_000,
                retries: 1,
              })
            : await backendPost(
                endpoint,
                url,
                {},
                {
                  token: caller.token,
                  apiKey: caller.apiKey,
                  timeoutMs: 15_000,
                  retries: 1,
                }
              );
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
          const text =
            format === "json"
              ? tApp("diag.observe.agent.tools.read-metadata-tool.8")
              : tApp("diag.observe.agent.tools.read-metadata-tool.9");
          return {
            content: [{ type: "text", text }],
          };
        }

        if (format === "markdown") {
          const markdown = formatMarkdownSchema(json);
          return {
            content: [
              {
                type: "text",
                text: markdown || tApp("diag.observe.agent.tools.read-metadata-tool.10"),
              },
            ],
          };
        }

        const data = unwrap(json);
        if (!hasJsonRule(data)) {
          return {
            content: [
              {
                type: "text",
                text: tApp("diag.observe.agent.tools.read-metadata-tool.11"),
              },
            ],
          };
        }

        return {
          content: [{ type: "text", text: formatJsonRule(data) }],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(tApp("diag.observe.agent.tools.read-metadata-tool.12"), err instanceof Error ? err : undefined);
        return {
          content: [{ type: "text", text: tApp("diag.observe.agent.tools.read-metadata-tool.13", { p0: msg }) }],
        };
      }
    },
  };
}
