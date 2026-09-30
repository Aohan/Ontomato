import type { AgentEvent, AgentState } from "../../core/agent-loop/types";
import { runAgentLoop } from "../../core/agent-loop/agent-loop";
import { createHarnessRun } from "../../core/agent-loop/session-run";
import {
  harnessSessions,
  HarnessSessionBusyError,
  type HarnessTurnStatus,
} from "../../infrastructure/harness-sessions";
import { renderPrompt, getPromptTemplate } from "../../core/prompts/loader";
import { ModelNotConfiguredError, resolveModelForRole } from "../../config/model-resolver";
import { runWithLogContext } from "../../logging/log-context";
import { createLogger } from "../../logging/logger";
import { HttpError } from "../../utils/errors";
import {
  governanceStore,
  publicGovernanceSession,
  type GovernanceOwner,
  type GovernanceRecord,
} from "./store";
import { createGovernanceTools } from "./tools";
import type { GovernanceCredentials } from "./materials";

const logger = createLogger("knowledge-governance");
const compactionPrompts = {
  system: "knowledge-governance.compaction.system",
  summarize: "knowledge-governance.compaction.summarize.user",
  update: "knowledge-governance.compaction.update.user",
};

export class GovernanceRuntime {
  private active = new Map<string, { controller: AbortController; done: Promise<void> }>();

  async start(owner: GovernanceOwner, credentials: GovernanceCredentials, locale: string) {
    const record = await governanceStore.create(owner);
    return this.respond(
      record.id,
      owner,
      credentials,
      locale,
      getPromptTemplate("knowledge-governance.main.start.user")
    );
  }

  async respond(
    id: string,
    owner: GovernanceOwner,
    credentials: GovernanceCredentials,
    locale: string,
    message: string
  ) {
    let record = await governanceStore.get(id, owner);
    let turnId: string;
    try {
      ({ turnId } = await harnessSessions.beginTurn(record.harnessSessionId));
    } catch (error) {
      if (error instanceof HarnessSessionBusyError)
        throw new HttpError(409, "Governance session is already running");
      throw error;
    }
    try {
      // Admission may have waited for the prior turn; take its final business work now.
      record = await governanceStore.get(id, owner);
    } catch (error) {
      await harnessSessions.finishTurn(record.harnessSessionId, turnId, "failed");
      throw error;
    }
    const controller = new AbortController();
    const done = runWithLogContext(
      { domainId: owner.domainId, token: credentials.token, apiKey: credentials.apiKey },
      () => this.run(record, turnId, credentials, locale, message, controller.signal)
    );
    this.active.set(id, { controller, done });
    void done
      .finally(() => {
        if (this.active.get(id)?.done === done) this.active.delete(id);
      })
      .catch((error) => {
        logger.error("Governance persistence failed", { sessionId: id, error: String(error) });
      });
    return publicGovernanceSession(await governanceStore.get(id, owner));
  }

  async stop(id: string, owner: GovernanceOwner) {
    await governanceStore.get(id, owner);
    this.active.get(id)?.controller.abort();
    return { success: true };
  }

  async wait(id: string) {
    await this.active.get(id)?.done;
  }

  private async run(
    record: GovernanceRecord,
    turnId: string,
    credentials: GovernanceCredentials,
    locale: string,
    message: string,
    signal: AbortSignal
  ) {
    let queue = Promise.resolve();
    const persist = () => {
      queue = queue.then(() => governanceStore.save(record, turnId));
      return queue;
    };
    let terminal: Exclude<HarnessTurnStatus, "running">;
    try {
      signal.throwIfAborted();
      record.draft = "";
      record.error = null;
      record.activity = "working";
      const model = await resolveModelForRole("knowledgeGovernance");
      const modelConfig = {
        baseUrl: model.baseUrl,
        apiKey: model.apiKey,
        modelName: model.modelName,
        maxTokens: model.maxTokens,
        modelKwargs: model.customRequestParameters,
        llmLog: { agentName: "KnowledgeGovernance", agentRunId: turnId },
      };
      const state: AgentState = {
        systemPrompt: "",
        messages: [],
        tools: createGovernanceTools(record, credentials, persist),
        isStreaming: false,
      };
      let lastDraftSaved = 0;
      const recordEvent = (event: AgentEvent) => {
        if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
          record.draft += event.assistantMessageEvent.delta || "";
          if (Date.now() - lastDraftSaved < 800) return;
          lastDraftSaved = Date.now();
        } else if (event.type === "message_end") {
          record.draft = "";
        } else if (event.type === "tool_execution_start") {
          record.activity = event.toolName;
        } else if (event.type === "turn_end") {
          record.activity = "working";
        } else return;
        void persist().catch(() => {
          /* The run awaits this same queue and reports failure. */
        });
      };
      await runAgentLoop(message, state, modelConfig, recordEvent, signal, {
        session: await createHarnessRun(harnessSessions, {
          sessionId: record.harnessSessionId,
          turnId,
          contextWindow: model.contextWindow,
          promptKeys: compactionPrompts,
        }),
        beforeTurn: async (current) => {
          signal.throwIfAborted();
          current.systemPrompt = renderPrompt(
            "knowledge-governance.main.system",
            {
              progress: JSON.stringify({
                summary: record.work.summary,
                notes: record.work.notes,
                reviewed: record.work.reviewedKnowledgeIds.length,
                knowledgeTotal: record.work.knowledgeTotal,
                issues: record.work.issues.map((issue) => ({
                  id: issue.id,
                  title: issue.title,
                  status: issue.status,
                })),
              }),
            },
            locale
          );
          await persist();
        },
      });
      const last = state.messages.at(-1);
      if (last?.role === "assistant" && last.stopReason === "error")
        throw new Error(last.errorMessage || "Model request failed");
      terminal = signal.aborted ? "cancelled" : "completed";
    } catch (error) {
      terminal = signal.aborted ? "cancelled" : "failed";
      if (!signal.aborted) {
        // When no model is configured for the role, directly provide the localized reason; other failures keep the generic message.
        record.error =
          error instanceof ModelNotConfiguredError
            ? error.message
            : "The governance response could not finish. Saved work is retained; please retry.";
        logger.error("Governance response failed", { sessionId: record.id, error: String(error) });
      }
    }
    record.draft = "";
    record.activity = "";
    try {
      await queue;
      await governanceStore.save(record, turnId);
    } catch (error) {
      terminal = "failed";
      throw error;
    } finally {
      await harnessSessions.finishTurn(record.harnessSessionId, turnId, terminal);
    }
  }
}

export const governanceRuntime = new GovernanceRuntime();
