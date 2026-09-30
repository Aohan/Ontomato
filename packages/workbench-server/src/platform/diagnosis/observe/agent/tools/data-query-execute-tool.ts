import fs from "node:fs";
import path from "node:path";

import type { AgentTool } from "../../../../../core/agent-loop/index";
import { getApiConfig, buildUrl } from "../../../../../config/data-query-api";
import { backendPost } from "../../../../../utils/backend-client";
import { createLogger } from "../../../../../logging/logger";
import { getBackendConfig } from "../../backend-config-fetcher";
import { resolveSkillDir } from "../skill-loader";
import { m3DiagnosticSupport } from "../../m3-support";
import { runtimeDefaults } from "../../../../../runtime/defaults";
import type { DiagnosisCallerIdentity } from "./caller-identity";
import { tApp } from "../../../../../i18n";


const logger = createLogger("observe:tool:data-query-execute");

const ENDPOINT = "/reportCard/querySql";
const MAX_RECORD_LENGTH = 800;
const SAMPLE_LIMIT = 25;

function formatRecord(record: unknown): string {
  const json = JSON.stringify(record);
  const line = json ?? String(record);
  return line.length > MAX_RECORD_LENGTH ? `${line.slice(0, MAX_RECORD_LENGTH)}...` : line;
}

function queryLanguage(dataAdapter: string): string {
  const m3 = m3DiagnosticSupport();
  return dataAdapter === "m3" && m3 ? m3.queryLanguage : tApp("diag.observe.agent.tools.data-query-execute-tool.0", { p0: dataAdapter });
}

export function createDataQueryExecuteTool(caller: DiagnosisCallerIdentity): AgentTool {
  const dataAdapter = getBackendConfig()?.dataAdapter || runtimeDefaults().defaultDataAdapter;
  const language = queryLanguage(dataAdapter);
  let description =
    tApp("diag.observe.agent.tools.data-query-execute-tool.1", { p0: dataAdapter, p1: language }) +
    tApp("diag.observe.agent.tools.data-query-execute-tool.2");

  const m3 = m3DiagnosticSupport();
  if (m3 && dataAdapter === "m3") {
    const mqlReferencePath = path.join(
      resolveSkillDir(),
      "query-flow-diagnosis",
      "references",
      m3.mqlReference.fileName
    );
    if (fs.existsSync(mqlReferencePath)) description += m3.mqlReference.hint(mqlReferencePath);
  }

  return {
    name: "data_query_execute",
    description,
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: tApp("diag.observe.agent.tools.data-query-execute-tool.3", { p0: language }) },
        limit: { type: "number", description: tApp("diag.observe.agent.tools.data-query-execute-tool.4"), default: 25 },
      },
      required: ["query"],
    },
    async execute(_toolCallId, params, signal) {
      const query = typeof params.query === "string" ? params.query.trim() : "";
      if (!query) {
        return { content: [{ type: "text", text: tApp("diag.observe.agent.tools.data-query-execute-tool.6") }] };
      }

      const requestedLimit = typeof params.limit === "number" ? params.limit : SAMPLE_LIMIT;
      const limit = Math.min(Math.max(Math.floor(requestedLimit), 1), SAMPLE_LIMIT);

      try {
        const apiConfig = getApiConfig();
        const url = buildUrl(apiConfig, ENDPOINT);
        const resp = await backendPost(
          ENDPOINT,
          url,
          { sql: query },
          {
            token: caller.token,
            apiKey: caller.apiKey,
            timeoutMs: 30_000,
            retries: 1,
            signal,
          }
        );
        let json: Record<string, unknown> = {};
        try {
          json = JSON.parse(resp.text);
        } catch {
          /* Keep the existing invalid-JSON fallback. */
        }

        if (json.success !== true) {
          const message = typeof json.message === "string" ? json.message : tApp("diag.observe.agent.tools.data-query-execute-tool.7");
          return { content: [{ type: "text", text: tApp("diag.observe.agent.tools.data-query-execute-tool.8", { p0: message }) }] };
        }
        if (!Array.isArray(json.data)) {
          return { content: [{ type: "text", text: tApp("diag.observe.agent.tools.data-query-execute-tool.9") }] };
        }

        const totalCount = json.data.length;
        if (totalCount === 0) {
          return { content: [{ type: "text", text: tApp("diag.observe.agent.tools.data-query-execute-tool.10") }] };
        }

        const records = json.data.slice(0, limit);
        const header = tApp("diag.observe.agent.tools.data-query-execute-tool.11", { p0: totalCount, p1: records.length });
        return {
          content: [{ type: "text", text: header + records.map(formatRecord).join("\n") }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(tApp("diag.observe.agent.tools.data-query-execute-tool.12"), error instanceof Error ? error : undefined);
        return { content: [{ type: "text", text: tApp("diag.observe.agent.tools.data-query-execute-tool.8", { p0: message }) }] };
      }
    },
  };
}
