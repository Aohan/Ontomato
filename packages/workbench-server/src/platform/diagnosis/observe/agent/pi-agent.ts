import { createHarnessRun } from "../../../../core/agent-loop/session-run";
import type {
  SessionContext,
  SessionHistorySnapshot,
  SessionInfo,
} from "@ontomato/contracts/diagnosis";
import { randomUUID } from "node:crypto";
import type { ModelConfig } from "../../../../core/agent-loop/types";
import {
  ModelNotConfiguredError,
  resolveModelForRole,
} from "../../../../config/model-resolver";
import { runWithLogContext } from "../../../../logging/log-context";
import {
  HarnessSessionBusyError,
  harnessSessions,
  type HarnessTurnStatus,
} from "../../../../infrastructure/harness-sessions";
import { messagesToSessionHistory } from "./session-history-view";
import { SessionResponseStream } from "./session-stream";
import { diagnosisSessions } from "./diagnosis-sessions";
import { DIAGNOSIS_COMPACTION_PROMPT_KEYS, diagnosisSummaryNote } from "./compaction/index";
import { bindResponseAgent, createManagedSession, type ManagedSession } from "./session-runtime";
import { executeResponse, logger } from "./session-response";
import type { DiagnosisCallerIdentity } from "./tools/caller-identity";
import { tApp } from "../../../../i18n";


export type StartChatResult =
  | { ok: true; stream: SessionResponseStream }
  | {
      ok: false;
      status: 400 | 404 | 409;
      code: "SESSION_NOT_FOUND" | "MODEL_NOT_CONFIGURED" | "RESPONSE_BUSY";
      error: string;
    };

export class DiagnosisSessionManager {
  private sessions = new Map<string, ManagedSession>();

  async createSession(params: { title?: string; context?: SessionContext }): Promise<SessionInfo> {
    const id = randomUUID();
    const title = params.title || tApp("diag.observe.agent.pi-agent.1", {
      p0: params.context?.targetKey || tApp("diag.observe.agent.pi-agent.2"),
    });
    const createdAt = new Date().toISOString();
    await harnessSessions.create(id);
    try {
      await diagnosisSessions.insert({
        id,
        title,
        createdAt,
        ...(params.context ? { context: params.context } : {}),
      });
    } catch (error) {
      await harnessSessions.deleteSession(id);
      throw error;
    }
    logger.info("Session created", {
      sessionId: id,
      context: params.context?.page,
      targetKey: params.context?.targetKey,
    });
    return { id, title, createdAt, context: params.context, responseStatus: "idle" };
  }

  async listSessions(): Promise<SessionInfo[]> {
    const rows = await diagnosisSessions.list();
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      createdAt: row.createdAt,
      context: row.context,
      responseStatus: row.responseStatus,
    }));
  }

  async deleteSession(sessionId: string): Promise<boolean> {
    const managed = this.sessions.get(sessionId);
    if (managed) {
      managed.latestResponse?.cancel();
      managed.agent?.abort();
      await managed.currentExecution;
      managed.agent?.dispose();
      this.sessions.delete(sessionId);
    }
    const row = await diagnosisSessions.get(sessionId);
    if (!row && !managed) return false;
    await harnessSessions.deleteSession(sessionId);
    logger.info("Session deleted", { sessionId });
    return true;
  }

  stopSession(sessionId: string): boolean {
    const managed = this.sessions.get(sessionId);
    if (!managed?.latestResponse || managed.latestResponse.status !== "running") return false;
    const cancelled = managed.latestResponse.cancel();
    if (cancelled) {
      managed.agent?.abort();
      logger.info("Session response cancellation requested", { sessionId });
    }
    return cancelled;
  }

  async startChat(
    sessionId: string,
    message: string,
    caller: DiagnosisCallerIdentity
  ): Promise<StartChatResult> {
    return runWithLogContext(
      { domainId: caller.domainId, token: caller.token, apiKey: caller.apiKey },
      async () => {
        const row = await diagnosisSessions.get(sessionId);
        if (!row)
          return { ok: false, status: 404, code: "SESSION_NOT_FOUND", error: "Session not found" };
        if (row.responseStatus === "running")
          return {
            ok: false,
            status: 409,
            code: "RESPONSE_BUSY",
            error: "Session response already running",
          };
        let captured: ModelConfig;
        let contextWindow: number;
        try {
          const entry = await resolveModelForRole("diagnosis");
          captured = {
            baseUrl: entry.baseUrl,
            apiKey: entry.apiKey,
            modelName: entry.modelName,
            maxTokens: entry.maxTokens,
            modelKwargs: entry.customRequestParameters,
          };
          contextWindow = entry.contextWindow;
        } catch (error) {
          if (error instanceof ModelNotConfiguredError)
            return { ok: false, status: 400, code: "MODEL_NOT_CONFIGURED", error: error.message };
          throw error;
        }
        let turnId: string;
        try {
          turnId = (await harnessSessions.beginTurn(sessionId)).turnId;
        } catch (error) {
          if (error instanceof HarnessSessionBusyError)
            return { ok: false, status: 409, code: "RESPONSE_BUSY", error: error.message };
          throw error;
        }
        const stream = new SessionResponseStream();
        let managed: ManagedSession | undefined;
        try {
          managed = createManagedSession(sessionId, row.context, caller);
          managed.latestResponse = stream;
          managed.turnId = turnId;
          this.sessions.get(sessionId)?.agent?.dispose();
          this.sessions.set(sessionId, managed);
        const run = await createHarnessRun(harnessSessions, {
          sessionId,
          turnId,
          contextWindow,
          promptKeys: DIAGNOSIS_COMPACTION_PROMPT_KEYS,
          summaryNote: diagnosisSummaryNote,
        });
        bindResponseAgent(managed, captured, run, async () => {
          const entry = await resolveModelForRole("diagnosis");
          return {
            contextWindow: entry.contextWindow,
            config: {
              baseUrl: entry.baseUrl,
              apiKey: entry.apiKey,
              modelName: entry.modelName,
              maxTokens: entry.maxTokens,
              modelKwargs: entry.customRequestParameters,
            },
          };
        });
        managed.currentExecution = executeResponse(sessionId, managed, message, stream, turnId);
        // Keep the settled promise for delete/stop ownership; failures must not become unhandled rejections.
        void managed.currentExecution.catch((error) =>
          logger.error("Diagnosis response failed", { sessionId, error })
        );
        return { ok: true, stream };
      } catch (error) {
        managed?.agent?.dispose();
        if (this.sessions.get(sessionId) === managed) this.sessions.delete(sessionId);
        await harnessSessions.finishTurn(sessionId, turnId, "failed");
        throw error;
      }
    });
  }

  getResponseStream(sessionId: string): SessionResponseStream | undefined {
    return this.sessions.get(sessionId)?.latestResponse;
  }

  async hasSession(sessionId: string): Promise<boolean> {
    return (await diagnosisSessions.get(sessionId)) !== null;
  }

  async getSessionHistory(sessionId: string): Promise<SessionHistorySnapshot | undefined> {
    const row = await diagnosisSessions.get(sessionId);
    if (!row) return undefined;
    const session = await harnessSessions.getSession(sessionId);
    const responseStatus = await historyStatus(sessionId, session?.status === "running");
    const activeTurnId = session?.status === "running" ? session.activeTurnId : null;
    const messages = await harnessSessions.listMessages(sessionId);
    const visible = activeTurnId
      ? messages.filter((item) => item.turnId !== activeTurnId)
      : messages;
    return {
      messages: messagesToSessionHistory(visible.map((item) => item.message)),
      responseStatus,
    };
  }
}

async function historyStatus(
  sessionId: string,
  running: boolean
): Promise<SessionHistorySnapshot["responseStatus"]> {
  if (running) return "running";
  const turn = await harnessSessions.latestTurn(sessionId);
  if (!turn) return "idle";
  return turn.status as Exclude<HarnessTurnStatus, "running">;
}

export const diagnosisManager = new DiagnosisSessionManager();
