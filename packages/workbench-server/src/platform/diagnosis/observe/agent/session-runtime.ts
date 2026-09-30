import type { SessionContext } from "@ontomato/contracts/diagnosis";
import type { ModelConfig } from "../../../../core/agent-loop/types";
import { Agent, type AgentTool, type HarnessRun } from "../../../../core/agent-loop/index";
import type { DiagnosisAgentRole } from "./role-loader";
import type { DiagnosisCallerIdentity } from "./tools/caller-identity";
import { createDiagnosisRuntimeCapabilities } from "./runtime-registry";
import { sessionSystemPrompt } from "./prompt-context";
import { createDispatchAgentTool } from "./tools/dispatch-agent-tool";
import type { SessionResponseStream } from "./session-stream";

export interface ManagedSession {
  sessionId: string;
  agent?: Agent;
  baseTools: AgentTool[];
  skillsIndex: string;
  roles: DiagnosisAgentRole[];
  context?: SessionContext;
  /** Caller of the request that started the current response. Not a stored permission. */
  caller: DiagnosisCallerIdentity;
  latestResponse?: SessionResponseStream;
  currentExecution?: Promise<void>;
  turnId?: string;
}

export function buildResponseTools(
  managed: ManagedSession,
  resolveChildModel: () => Promise<{ config: ModelConfig; contextWindow: number }> | { config: ModelConfig; contextWindow: number }
): AgentTool[] {
  if (managed.roles.length === 0) return managed.baseTools;
  return [
    ...managed.baseTools,
    createDispatchAgentTool({
      roles: managed.roles,
      baseTools: managed.baseTools,
      skillsIndex: managed.skillsIndex,
      context: managed.context,
      parentSessionId: managed.sessionId,
      resolveChildModel,
    }),
  ];
}

export function createManagedSession(
  sessionId: string,
  context: SessionContext | undefined,
  caller: DiagnosisCallerIdentity
): ManagedSession {
  const runtime = createDiagnosisRuntimeCapabilities(caller);
  return {
    sessionId,
    baseTools: runtime.tools,
    skillsIndex: runtime.skillsIndex,
    roles: runtime.roles,
    context,
    caller,
  };
}

export function bindResponseAgent(
  managed: ManagedSession,
  config: ModelConfig,
  session: HarnessRun,
  resolveChildModel: () => Promise<{ config: ModelConfig; contextWindow: number }> | { config: ModelConfig; contextWindow: number }
): Agent {
  const agent = new Agent(config, {
    systemPrompt: sessionSystemPrompt(managed.skillsIndex, managed.context),
    tools: buildResponseTools(managed, resolveChildModel),
    session,
  });
  managed.agent = agent;
  return agent;
}
