import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { AgentMessage } from "@ontomato/contracts/agent-messages";
import { getPostgresPool, qualifiedTable } from "./postgres";

export class HarnessSessionBusyError extends Error {
  constructor() {
    super("Session response already running");
  }
}
export type HarnessTurnStatus = "running" | "completed" | "cancelled" | "failed" | "interrupted";
export interface HarnessMessageRow {
  seq: number;
  turnId: string;
  message: AgentMessage;
}
export interface HarnessSessionRow {
  id: string;
  status: "idle" | "running";
  activeTurnId: string | null;
  parentSessionId: string | null;
  parentToolCallId: string | null;
}

async function transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPostgresPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function lockSession(client: PoolClient, sessionId: string): Promise<HarnessSessionRow> {
  const result = await client.query(
    `SELECT id, status, active_turn_id AS "activeTurnId", parent_session_id AS "parentSessionId",
     parent_tool_call_id AS "parentToolCallId" FROM ${qualifiedTable("harness_sessions")} WHERE id = $1 FOR UPDATE`,
    [sessionId]
  );
  if (!result.rows[0]) throw new Error(`Harness session not found: ${sessionId}`);
  return result.rows[0] as HarnessSessionRow;
}
function requireActiveTurn(session: HarnessSessionRow, turnId: string): void {
  if (session.status !== "running" || session.activeTurnId !== turnId) {
    throw new Error("Harness turn is no longer active");
  }
}

export const harnessSessions = {
  async create(id: string, parentSessionId?: string, parentToolCallId?: string): Promise<void> {
    await getPostgresPool().query(
      `INSERT INTO ${qualifiedTable("harness_sessions")} (id, parent_session_id, parent_tool_call_id, status)
       VALUES ($1, $2, $3, 'idle')`,
      [id, parentSessionId ?? null, parentToolCallId ?? null]
    );
  },
  async beginTurn(sessionId: string): Promise<{ turnId: string; turnIndex: number }> {
    return transaction(async (client) => {
      const session = await lockSession(client, sessionId);
      if (session.status === "running") throw new HarnessSessionBusyError();
      const result = await client.query(
        `SELECT COALESCE(MAX(turn_index), 0) + 1 AS value FROM ${qualifiedTable("harness_turns")} WHERE session_id = $1`,
        [sessionId]
      );
      const turnIndex = Number(result.rows[0].value);
      const turnId = randomUUID();
      await client.query(
        `INSERT INTO ${qualifiedTable("harness_turns")} (id, session_id, turn_index, status) VALUES ($1, $2, $3, 'running')`,
        [turnId, sessionId, turnIndex]
      );
      await client.query(
        `UPDATE ${qualifiedTable("harness_sessions")} SET status = 'running', active_turn_id = $2, updated_at = NOW() WHERE id = $1`,
        [sessionId, turnId]
      );
      return { turnId, turnIndex };
    });
  },
  async finishTurn(
    sessionId: string,
    turnId: string,
    status: Exclude<HarnessTurnStatus, "running">
  ): Promise<void> {
    await transaction(async (client) => {
      const session = await lockSession(client, sessionId);
      // A late completion may not change an earlier terminal turn or release a newer run.
      if (session.activeTurnId !== turnId) return;
      await client.query(
        `UPDATE ${qualifiedTable("harness_turns")} SET status = $3, finished_at = NOW()
         WHERE id = $2 AND session_id = $1 AND status = 'running'`,
        [sessionId, turnId, status]
      );
      await client.query(
        `UPDATE ${qualifiedTable("harness_sessions")} SET status = 'idle', active_turn_id = NULL, updated_at = NOW() WHERE id = $1`,
        [sessionId]
      );
    });
  },
  /** Called once at server startup before requests are accepted, never while loading a session. */
  async recoverAllInterrupted(): Promise<void> {
    await transaction(async (client) => {
      await client.query(
        `UPDATE ${qualifiedTable("harness_turns")} SET status = 'interrupted', finished_at = NOW() WHERE status = 'running'`
      );
      await client.query(
        `UPDATE ${qualifiedTable("harness_sessions")} SET status = 'idle', active_turn_id = NULL, updated_at = NOW() WHERE status = 'running'`
      );
    });
  },
  async appendMessage(sessionId: string, turnId: string, message: AgentMessage): Promise<number> {
    return transaction(async (client) => {
      requireActiveTurn(await lockSession(client, sessionId), turnId);
      const next = await client.query(
        `SELECT COALESCE(MAX(seq), 0) + 1 AS value FROM ${qualifiedTable("harness_messages")} WHERE session_id = $1`,
        [sessionId]
      );
      const seq = Number(next.rows[0].value);
      await client.query(
        `INSERT INTO ${qualifiedTable("harness_messages")} (session_id, turn_id, seq, message) VALUES ($1, $2, $3, $4::jsonb)`,
        [sessionId, turnId, seq, JSON.stringify(message)]
      );
      return seq;
    });
  },
  async writeCompaction(
    sessionId: string,
    turnId: string,
    summary: string,
    coveredThroughSeq: number
  ): Promise<void> {
    await transaction(async (client) => {
      requireActiveTurn(await lockSession(client, sessionId), turnId);
      await client.query(
        `INSERT INTO ${qualifiedTable("harness_compactions")} (id, session_id, summary, covered_through_seq) VALUES ($1, $2, $3, $4)`,
        [randomUUID(), sessionId, summary, coveredThroughSeq]
      );
    });
  },
  async listMessages(sessionId: string, turnId?: string): Promise<HarnessMessageRow[]> {
    const result = await getPostgresPool().query(
      `SELECT seq, turn_id AS "turnId", message FROM ${qualifiedTable("harness_messages")}
       WHERE session_id = $1 AND ($2::text IS NULL OR turn_id = $2) ORDER BY seq`,
      [sessionId, turnId ?? null]
    );
    return result.rows.map((row) => ({
      seq: Number(row.seq),
      turnId: String(row.turnId),
      message: row.message as AgentMessage,
    }));
  },
  async readContextSnapshot(sessionId: string): Promise<{
    rows: HarnessMessageRow[];
    compaction: { summary: string; coveredThroughSeq: number; createdAt: string } | null;
  }> {
    const result = await getPostgresPool().query(
      `SELECT summary, covered_through_seq AS "coveredThroughSeq", created_at AS "createdAt"
       FROM ${qualifiedTable("harness_compactions")} WHERE session_id = $1 ORDER BY covered_through_seq DESC, created_at DESC LIMIT 1`,
      [sessionId]
    );
    const latest = result.rows[0];
    return {
      rows: await this.listMessages(sessionId),
      compaction: latest
        ? {
            summary: String(latest.summary),
            coveredThroughSeq: Number(latest.coveredThroughSeq),
            createdAt: new Date(latest.createdAt).toISOString(),
          }
        : null,
    };
  },

  async getSession(sessionId: string): Promise<HarnessSessionRow | null> {
    const result = await getPostgresPool().query(
      `SELECT id, status, active_turn_id AS "activeTurnId", parent_session_id AS "parentSessionId", parent_tool_call_id AS "parentToolCallId"
       FROM ${qualifiedTable("harness_sessions")} WHERE id = $1`,
      [sessionId]
    );
    return (result.rows[0] as HarnessSessionRow | undefined) ?? null;
  },
  async listChildren(parentSessionId: string): Promise<HarnessSessionRow[]> {
    const result = await getPostgresPool().query(
      `SELECT id, status, active_turn_id AS "activeTurnId", parent_session_id AS "parentSessionId", parent_tool_call_id AS "parentToolCallId"
       FROM ${qualifiedTable("harness_sessions")} WHERE parent_session_id = $1 ORDER BY created_at, id`,
      [parentSessionId]
    );
    return result.rows as HarnessSessionRow[];
  },
  async latestTurn(sessionId: string): Promise<{ id: string; status: HarnessTurnStatus } | null> {
    const result = await getPostgresPool().query(
      `SELECT id, status FROM ${qualifiedTable("harness_turns")} WHERE session_id = $1 ORDER BY turn_index DESC LIMIT 1`,
      [sessionId]
    );
    return (result.rows[0] as { id: string; status: HarnessTurnStatus } | undefined) ?? null;
  },
  async deleteSession(sessionId: string): Promise<boolean> {
    const result = await getPostgresPool().query(
      `DELETE FROM ${qualifiedTable("harness_sessions")} WHERE id = $1`,
      [sessionId]
    );
    return (result.rowCount ?? 0) > 0;
  },
};
