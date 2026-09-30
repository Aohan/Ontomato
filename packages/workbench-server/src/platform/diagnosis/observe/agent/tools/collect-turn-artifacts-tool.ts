import fs from "node:fs";

import type { AgentTool } from "../../../../../core/agent-loop/index";
import { buildTurnWorkspace } from "../../workspaces/builder";
import { deleteWorkspace, getWorkspacePath, loadManifest } from "../../workspaces/store";
import type { DiagnosisCallerIdentity } from "./caller-identity";
import { getCheckpointer } from "../../../../../infrastructure/connection";
import { parseTurnKeyOrThrow } from "../../workspaces/turn-resolver";
import { tApp } from "../../../../../i18n";


/** Rebuild one Turn workspace and hand its location back to the agent. */
export function createCollectTurnArtifactsTool(caller: DiagnosisCallerIdentity): AgentTool {
  return {
    name: "collect_turn_artifacts",
    description:
      tApp("diag.observe.agent.tools.collect-turn-artifacts-tool.0"),
    executionMode: "sequential",
    parameters: {
      type: "object",
      properties: {
        turnKey: {
          type: "string",
          description: tApp("diag.observe.agent.tools.collect-turn-artifacts-tool.1"),
        },
      },
      required: ["turnKey"],
    },
    async execute(_toolCallId, params, signal) {
      signal?.throwIfAborted();
      const turnKey = typeof params.turnKey === "string" ? params.turnKey.trim() : "";
      if (!turnKey) {
        return {
          content: [{ type: "text", text: tApp("diag.observe.agent.tools.collect-turn-artifacts-tool.3") }],
        };
      }

      try {
        const domainId = caller.domainId;
        const checkpointer = getCheckpointer();
        if (!checkpointer) throw new Error("Thread storage unavailable");
        await checkpointer.verifyThreadDomain(parseTurnKeyOrThrow(turnKey).threadId, domainId);
        const existing = loadManifest(turnKey);
        if (existing && existing.domainId !== domainId)
          throw new Error("Workspace domain does not match the credential");
        signal?.throwIfAborted();
        const workspacePath = getWorkspacePath(turnKey);
        if (fs.existsSync(workspacePath) && !deleteWorkspace(turnKey)) {
          return {
            content: [
              {
                type: "text",
                text: tApp("diag.observe.agent.tools.collect-turn-artifacts-tool.4"),
              },
            ],
          };
        }

        const manifest = await buildTurnWorkspace({
          turnKey,
          domainId,
          token: caller.token,
          apiKey: caller.apiKey,
          signal,
        });
        signal?.throwIfAborted();
        if (manifest.status === "failed") {
          return {
            content: [
              {
                type: "text",
                text: tApp("diag.observe.agent.tools.collect-turn-artifacts-tool.5", {
                  p0: manifest.error || tApp("diag.observe.agent.tools.collect-turn-artifacts-tool.6"),
                }),
              },
            ],
          };
        }
        if (manifest.status !== "completed") {
          return {
            content: [
              {
                type: "text",
                text: tApp("diag.observe.agent.tools.collect-turn-artifacts-tool.7", { p0: manifest.status }),
              },
            ],
          };
        }

        return { content: [{ type: "text", text: workspacePath }] };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: tApp("diag.observe.agent.tools.collect-turn-artifacts-tool.5", { p0: message }) }],
        };
      }
    },
  };
}
