import type { AgentTool } from "../../../../../core/agent-loop/index";
import { createBuiltinTools } from "./builtin/index";
import { createCollectTurnArtifactsTool } from "./collect-turn-artifacts-tool";
import { createDataQueryExecuteTool } from "./data-query-execute-tool";
import { createViewAppConfigTool } from "./view-app-config-tool";
import { createServiceHealthTool } from "./service-health-tool";
import { createReadMetadataTool } from "./read-metadata-tool";
import type { TkHolder } from "./tk-holder";

/**
 * Build the diagnosis tool set for a session.
 *
 * @param tkHolder Per-session holder for the datarag login token. Captured in a
 *   closure by the datarag-backed tools (`collect_turn_artifacts`,
 *   `data_query_execute`, `read_metadata`, `view_app_config`, `service_health`) so they read the
 *   latest page `tk` at execute time without changing the
 *   `AgentTool.execute` signature.
 */
export function createDiagnosisTools(tkHolder: TkHolder): AgentTool[] {
  return [
    // 7 builtin tools: read, write, edit, bash, grep, find, ls
    ...createBuiltinTools(),
    // Diagnosis-specific tools
    createCollectTurnArtifactsTool(tkHolder),
    createDataQueryExecuteTool(tkHolder),
    // datarag read-only tools (tk via per-session holder)
    createViewAppConfigTool(tkHolder),
    createServiceHealthTool(tkHolder),
    createReadMetadataTool(tkHolder),
  ];
}
