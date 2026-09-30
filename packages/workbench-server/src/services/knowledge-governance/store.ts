import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  governanceSessionSchema,
  governanceSummarySchema,
  governanceWorkSchema,
  type GovernanceSession,
} from "@ontomato/contracts/knowledge-governance";
import { toEgressMessages } from "../../core/agent-loop/egress";
import {
  harnessSessions,
  type HarnessMessageRow,
  type HarnessTurnStatus,
} from "../../infrastructure/harness-sessions";
import { getPostgresPool, qualifiedTable } from "../../infrastructure/postgres";
import { HttpError } from "../../utils/errors";

export interface GovernanceOwner {
  domainId: string;
  userId: string;
}
const payloadSchema = z.object({
  work: governanceWorkSchema,
  draft: z.string(),
  activity: z.string(),
  error: z.string().nullable(),
});
export interface GovernanceRecord extends GovernanceSession {
  harnessSessionId: string;
}

function statusOf(turnStatus: HarnessTurnStatus | null): GovernanceSession["status"] {
  switch (turnStatus) {
    case "running":
      return "running";
    case "failed":
      return "failed";
    case "cancelled":
    case "interrupted":
      return "stopped";
    case "completed":
    case null:
      return "idle";
  }
}
function harnessReference(value: unknown): string {
  if (typeof value !== "string" || !value) {
    throw new Error("Governance session requires an external upgrade to Harness storage");
  }
  return value;
}

// Read business work, execution state and raw messages in one database snapshot.
// The business payload never owns execution status or a second conversation copy.
function readFrom(includeMessages: boolean): string {
  return `SELECT g.*, t.status AS turn_status, COALESCE(t.turn_index, 0) AS turn_index,
    GREATEST(g.updated_at, h.updated_at) AS updated_at
    ${
      includeMessages
        ? `, COALESCE((SELECT jsonb_agg(jsonb_build_object('seq', m.seq, 'turnId', m.turn_id, 'message', m.message) ORDER BY m.seq)
      FROM ${qualifiedTable("harness_messages")} m WHERE m.session_id = h.id), '[]'::jsonb) AS raw_messages`
        : ""
    }
    FROM ${qualifiedTable("knowledge_governance_sessions")} g
    LEFT JOIN ${qualifiedTable("harness_sessions")} h ON h.id = g.harness_session_id
    LEFT JOIN LATERAL (SELECT status, turn_index FROM ${qualifiedTable("harness_turns")}
      WHERE session_id = h.id ORDER BY turn_index DESC LIMIT 1) t ON true`;
}
function fromRow(row: Record<string, unknown>): GovernanceRecord {
  const harnessSessionId = harnessReference(row.harness_session_id);
  const payload = payloadSchema.parse(row.payload);
  const status = statusOf(row.turn_status as HarnessTurnStatus | null);
  const rows = row.raw_messages as HarnessMessageRow[];
  const messages = rows.flatMap(({ seq, message }) => {
    const publicMessage = toEgressMessages([message], {
      thinking: "omit",
      toolResultContent: "full",
    })[0]!;
    if (publicMessage.role === "toolResult") return [];
    const text = publicMessage.content
      .flatMap((part) => (part.type === "text" ? [part.text] : []))
      .join("");
    return text.trim()
      ? [
          {
            id: `${harnessSessionId}:${seq}`,
            role: publicMessage.role,
            text,
            timestamp: publicMessage.timestamp ?? new Date(String(row.created_at)).getTime(),
          },
        ]
      : [];
  });
  return {
    ...governanceSessionSchema.parse({
      ...payload,
      id: row.id,
      domainId: row.domain_id,
      initiatorId: row.initiator_id,
      createdAt: new Date(String(row.created_at)).toISOString(),
      updatedAt: new Date(String(row.updated_at)).toISOString(),
      // begin/finish/recovery also advance the public revision, even without a business save.
      revision: Number(row.revision) + Number(row.turn_index) * 2 + (status === "running" ? 0 : 1),
      status,
      messages,
      draft: status === "running" && rows.at(-1)?.message.role !== "assistant" ? payload.draft : "",
      activity: status === "running" ? payload.activity : "",
      error: status === "failed" ? payload.error : null,
    }),
    harnessSessionId,
  };
}

export const governanceStore = {
  async create(owner: GovernanceOwner): Promise<GovernanceRecord> {
    const id = randomUUID();
    await harnessSessions.create(id);
    try {
      await getPostgresPool().query(
        `INSERT INTO ${qualifiedTable("knowledge_governance_sessions")} (id, domain_id, initiator_id, harness_session_id, payload)
         VALUES ($1::uuid, $2, $3, $1::text, $4)`,
        [
          id,
          owner.domainId,
          owner.userId,
          JSON.stringify({
            draft: "",
            activity: "",
            error: null,
            work: {
              summary: "",
              notes: "",
              reviewedKnowledgeIds: [],
              knowledgeTotal: null,
              issues: [],
              sources: [],
            },
          }),
        ]
      );
    } catch (error) {
      await harnessSessions.deleteSession(id);
      throw error;
    }
    return this.get(id, owner);
  },
  async list(owner: GovernanceOwner) {
    const { rows } = await getPostgresPool().query(
      `${readFrom(false)} WHERE g.domain_id = $1 AND g.initiator_id = $2 ORDER BY g.updated_at DESC, g.id LIMIT 100`,
      [owner.domainId, owner.userId]
    );
    return rows.map((row) => {
      harnessReference(row.harness_session_id);
      return governanceSummarySchema.parse({
        id: row.id,
        status: statusOf(row.turn_status),
        createdAt: new Date(row.created_at).toISOString(),
        updatedAt: new Date(row.updated_at).toISOString(),
      });
    });
  },
  async get(id: string, owner: GovernanceOwner): Promise<GovernanceRecord> {
    const { rows } = await getPostgresPool().query(
      `${readFrom(true)} WHERE g.id = $1 AND g.domain_id = $2 AND g.initiator_id = $3`,
      [id, owner.domainId, owner.userId]
    );
    if (!rows[0]) throw new HttpError(404, "Governance session not found");
    return fromRow(rows[0]);
  },
  async save(record: GovernanceRecord, turnId: string): Promise<void> {
    const client = await getPostgresPool().connect();
    try {
      await client.query("BEGIN");
      // Share the same row lock as Harness admission and completion, so a delayed
      // business save cannot race a newer turn or revive a terminal one.
      const active = await client.query(
        `SELECT active_turn_id FROM ${qualifiedTable("harness_sessions")}
        WHERE id = $1 FOR UPDATE`,
        [record.harnessSessionId]
      );
      if (active.rows[0]?.active_turn_id !== turnId)
        throw new Error("Governance run no longer owns this session");
      const { rowCount } = await client.query(
        `UPDATE ${qualifiedTable("knowledge_governance_sessions")} SET payload = $3,
         revision = revision + 1, updated_at = NOW() WHERE id = $1 AND harness_session_id = $2`,
        [
          record.id,
          record.harnessSessionId,
          JSON.stringify({
            work: record.work,
            draft: record.draft,
            activity: record.activity,
            error: record.error,
          }),
        ]
      );
      if (rowCount !== 1) throw new Error("Governance session not found");
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },
};

export function publicGovernanceSession(record: GovernanceRecord): GovernanceSession {
  return governanceSessionSchema.parse(record);
}
