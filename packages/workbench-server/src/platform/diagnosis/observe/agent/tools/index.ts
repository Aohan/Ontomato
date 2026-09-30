import type { AgentTool } from "../../../../../core/agent-loop/index";
import { createBuiltinTools } from "./builtin/index";
import { createCollectTurnArtifactsTool } from "./collect-turn-artifacts-tool";
import { createDataQueryExecuteTool } from "./data-query-execute-tool";
import { createViewAppConfigTool } from "./view-app-config-tool";
import { createServiceHealthTool } from "./service-health-tool";
import { createReadMetadataTool } from "./read-metadata-tool";
import type { DiagnosisCallerIdentity } from "./caller-identity";

/**
 * Build the diagnosis tool set for a session.
 *
 * @param caller The caller of the current response. The datarag-backed tools
 *   (`collect_turn_artifacts`, `data_query_execute`, `read_metadata`, `view_app_config`,
 *   `service_health`) use its domain and credential for their backend calls.
 */
export function createDiagnosisTools(caller: DiagnosisCallerIdentity): AgentTool[] {
  return [
    // 7 builtin tools: read, write, edit, bash, grep, find, ls
    ...createBuiltinTools(),
    // Diagnosis-specific tools
    createCollectTurnArtifactsTool(caller),
    createDataQueryExecuteTool(caller),
    // datarag read-only tools (credentials via per-session holder)
    createViewAppConfigTool(caller),
    createServiceHealthTool(caller),
    createReadMetadataTool(caller),
  ];
}
