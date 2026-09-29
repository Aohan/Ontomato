import { createHarnessRun } from "../../../../../core/agent-loop/session-run";
import type { EgressTextContent as TextContent } from "@ontomato/contracts/agent-egress";
import type { SessionContext } from "@ontomato/contracts/diagnosis";
import { randomUUID } from "node:crypto";
import { Agent } from "../../../../../core/agent-loop/agent";
import type { AgentMessage, AgentTool, ModelConfig } from "../../../../../core/agent-loop/types";
import {
  harnessSessions,
  type HarnessTurnStatus,
} from "../../../../../infrastructure/harness-sessions";
import { DIAGNOSIS_COMPACTION_PROMPT_KEYS, diagnosisSummaryNote } from "../compaction/index";
import { buildLocationBlock } from "../prompt-context";
import type { DiagnosisAgentRole } from "../role-loader";
import { tApp } from "../../../../../i18n";


export interface DispatchAgentToolOptions {
  roles: DiagnosisAgentRole[];
  baseTools: AgentTool[];
  skillsIndex: string;
  context?: SessionContext;
  parentSessionId: string;
  /** Read at dispatch time, not when the parent response captured its model. */
  resolveChildModel(): Promise<{ config: ModelConfig; contextWindow: number }> | { config: ModelConfig; contextWindow: number };
}

function lastAssistantMessage(messages: AgentMessage[]) {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]!;
    if (message.role === "assistant") return message;
  }
  return undefined;
}

function assistantText(message: AgentMessage | undefined): string {
  if (!message || message.role !== "assistant") return "";
  return message.content
    .filter((part): part is TextContent => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();
}

function roleSystemPrompt(
  role: DiagnosisAgentRole,
  skillsIndex: string,
  context?: SessionContext
): string {
  return [role.systemPrompt, skillsIndex, buildLocationBlock(context)].filter(Boolean).join("\n\n");
}

export function createDispatchAgentTool(options: DispatchAgentToolOptions): AgentTool {
  const roles = new Map(options.roles.map((role) => [role.name, role]));
  const baseTools = new Map(options.baseTools.map((tool) => [tool.name, tool]));

  for (const role of options.roles) {
    for (const toolName of role.tools) {
      if (!baseTools.has(toolName) || toolName === "dispatch_agent") {
        throw new Error(`Role ${role.name} references unavailable tool: ${toolName}`);
      }
    }
  }

  const roleSummary = options.roles.map((role) => `${role.name}: ${role.description}`).join("; ");

  return {
    name: "dispatch_agent",
    description:
      tApp("diag.observe.agent.tools.dispatch-agent-tool.0") +
      tApp("diag.observe.agent.tools.dispatch-agent-tool.1", { p0: roleSummary }),
    executionMode: "sequential",
    parameters: {
      type: "object",
      properties: {
        role: {
          type: "string",
          description: tApp("diag.observe.agent.tools.dispatch-agent-tool.2", {
            p0: options.roles.map((role) => role.name).join(", "),
          }),
        },
        task: {
          type: "string",
          description: tApp("diag.observe.agent.tools.dispatch-agent-tool.3"),
        },
      },
      required: ["role", "task"],
    },
    async execute(_toolCallId, params, signal) {
      const roleName = typeof params.role === "string" ? params.role : "";
      const task = typeof params.task === "string" ? params.task.trim() : "";
      const role = roles.get(roleName);
      if (!role) {
        throw new Error(
          `Unknown sub-agent role: ${roleName || "(empty)"}. Available roles: ${[
            ...roles.keys(),
          ].join(", ")}`
        );
      }
      if (!task) throw new Error("Sub-agent task is required");
      if (signal?.aborted) throw new Error("Sub-agent task cancelled before start");

      const childSessionId = randomUUID();
      await harnessSessions.create(childSessionId, options.parentSessionId, _toolCallId);
      const turn = await harnessSessions.beginTurn(childSessionId);
      let terminal: Exclude<HarnessTurnStatus, "running"> = "failed";
      let child: Agent | undefined;
      try {
        const resolved = await options.resolveChildModel();
        child = new Agent(resolved.config, {
          systemPrompt: roleSystemPrompt(role, options.skillsIndex, options.context),
          tools: role.tools.map((name) => baseTools.get(name)!),
          session: await createHarnessRun(harnessSessions, {
            sessionId: childSessionId,
            turnId: turn.turnId,
            contextWindow: resolved.contextWindow,
            promptKeys: DIAGNOSIS_COMPACTION_PROMPT_KEYS,
            summaryNote: diagnosisSummaryNote,
          }),
        });
        await child.prompt(task, signal);
        const last = lastAssistantMessage(child.state.messages);
        if (signal?.aborted || last?.stopReason === "aborted") {
          terminal = "cancelled";
          throw new Error("Sub-agent task cancelled");
        }
        if (last?.stopReason === "error") {
          terminal = "failed";
          throw new Error(
            `Sub-agent task failed: ${last.errorMessage || "Unknown child-agent error"}`
          );
        }
        terminal = "completed";
        const result = assistantText(last);
        return {
          content: [{ type: "text", text: result || "Sub-agent completed without a text result." }],
        };
      } catch (error) {
        if (terminal === "failed" && signal?.aborted) terminal = "cancelled";
        throw error;
      } finally {
        try {
          await harnessSessions.finishTurn(childSessionId, turn.turnId, terminal);
        } finally {
          child?.dispose();
        }
      }
    },
  };
}
