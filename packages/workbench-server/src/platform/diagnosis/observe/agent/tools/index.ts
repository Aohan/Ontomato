import type { AgentTool } from "../../../../../core/agent-loop/index";
import { createBuiltinTools } from "./builtin/index";
import { createCollectTurnArtifactsTool } from "./collect-turn-artifacts-tool";
import { createDataQueryExecuteTool } from "./data-query-execute-tool";
import { createViewAppConfigTool } from "./view-app-config-tool";
import { createServiceHealthTool } from "./service-health-tool";
import { createReadMetadataTool } from "./read-metadata-tool";
import type { CallerHolder } from "./caller-holder";

/**
 * Build the diagnosis tool set for a session.
 *
 * @param callerHolder Per-session holder for the caller's identity. Captured in a
 *   closure by the datarag-backed tools (`collect_turn_artifacts`,
 *   `data_query_execute`, `read_metadata`, `view_app_config`, `service_health`) so they read the
 *   latest caller credentials and domain at execute time without changing the
 *   `AgentTool.execute` signature.
 */
export function createDiagnosisTools(callerHolder: CallerHolder): AgentTool[] {
  return [
    // 7 builtin tools: read, write, edit, bash, grep, find, ls
    ...createBuiltinTools(),
    // Diagnosis-specific tools
    createCollectTurnArtifactsTool(callerHolder),
    createDataQueryExecuteTool(callerHolder),
    // datarag read-only tools (credentials via per-session holder)
    createViewAppConfigTool(callerHolder),
    createServiceHealthTool(callerHolder),
    createReadMetadataTool(callerHolder),
  ];
}
