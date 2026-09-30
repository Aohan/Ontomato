import type { ThreadListResponse } from "@ontomato/contracts/chat";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { emptyCheckpoint, type Checkpoint } from "@langchain/langgraph-checkpoint";
import type { BaseMessage } from "@langchain/core/messages";
import type { RunnableConfig } from "@langchain/core/runnables";
import type pg from "pg";
import { t, tApp } from "../i18n";
import { createLogger } from "../logging/logger";
import { getPostgresPool, qualifiedTable } from "./postgres";
import { HttpError } from "../utils/errors";

const logger = createLogger("checkpointer");
// LangGraph recovery data keeps the existing public storage; PG_SCHEMA selects only business tables.
const CHECKPOINT_SCHEMA = "public";
const CHECKPOINT_TABLE = `"${CHECKPOINT_SCHEMA}"."checkpoints"`;

/** Domain-wide reads are available only to callers with an explicit domain capability. */
export type ThreadReadAccess =
  | { domainId: string; userId: string; scope?: never }
  | { domainId: string; scope: "domain"; userId?: never };

function getMessageRequestSeq(message: any): number | undefined {
  const value =
    message.kwargs?.additional_kwargs?.requestSeq ?? message.additional_kwargs?.requestSeq;
  return typeof value === "number" ? value : undefined;
}

function toThreadMessage(role: "user" | "assistant", content: string, message: any) {
  const requestSeq = getMessageRequestSeq(message);
  return { role, content, ...(requestSeq === undefined ? {} : { requestSeq }) };
}

export class ExtendedPostgresSaver extends PostgresSaver {
  constructor(pool: pg.Pool) {
    super(pool, undefined, { schema: CHECKPOINT_SCHEMA });
  }

  async start(): Promise<void> {
    await this.setup();
    logger.info(tApp("foundation.log.checkpointer.ready"));
  }

  async getThreadList(
    options: ThreadReadAccess & {
      limit?: number;
      offset?: number;
      threadType?: string;
    }
  ): Promise<ThreadListResponse> {
    const { limit = 50, offset = 0, threadType = "qa" } = options;

    const params: any[] = [options.domainId];
    const predicates: string[] = ["metadata.domain_id = $1"];
    if (options.scope !== "domain") {
      params.push(options.userId);
      predicates.push("metadata.user_id = $2");
    }
    if (threadType) {
      params.push(threadType);
      predicates.push(`metadata.thread_type = $${params.length}`);
    }
    predicates.push(`(
      EXISTS (
        SELECT 1 FROM ${CHECKPOINT_TABLE} checkpoints
        WHERE checkpoints.thread_id = metadata.thread_id
      )
      OR EXISTS (
        SELECT 1 FROM ${qualifiedTable("turn_runs")} turn_runs
        WHERE turn_runs.thread_id = metadata.thread_id
      )
    )`);
    const whereClause = `WHERE ${predicates.join(" AND ")}`;

    const countResult = await getPostgresPool().query(
      `SELECT COUNT(*) as total
       FROM ${qualifiedTable("thread_metadata")} metadata
       ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0]?.total || "0", 10);

    const limitIdx = params.length + 1;
    const offsetIdx = params.length + 2;
    params.push(limit, offset);

    const result = await getPostgresPool().query(
      `SELECT metadata.thread_id,
              metadata.title,
              metadata.updated_at,
              metadata.created_at,
              COALESCE(checkpoint_stats.message_count, 0) as message_count,
              checkpoint_stats.last_checkpoint_id
       FROM ${qualifiedTable("thread_metadata")} metadata
       LEFT JOIN (
         SELECT thread_id, COUNT(*) as message_count, MAX(checkpoint_id) as last_checkpoint_id
         FROM ${CHECKPOINT_TABLE}
         GROUP BY thread_id
       ) checkpoint_stats ON checkpoint_stats.thread_id = metadata.thread_id
       ${whereClause}
       ORDER BY COALESCE(metadata.updated_at, metadata.created_at) DESC, metadata.thread_id
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params
    );

    return {
      threads: result.rows.map((row) => ({
        threadId: row.thread_id,
        title: row.title || t("checkpointer.newConversation"),
        messageCount: parseInt(row.message_count, 10),
        updatedAt: row.updated_at,
        createdAt: row.created_at,
        lastCheckpointId: row.last_checkpoint_id,
      })),
      total,
    };
  }

  async hasCheckpoints(threadId: string): Promise<boolean> {
    const result = await getPostgresPool().query(
      `SELECT 1 FROM ${CHECKPOINT_TABLE} WHERE thread_id = $1 LIMIT 1`,
      [threadId]
    );
    return (result.rowCount ?? 0) > 0;
  }

  async isThreadTitleLocked(threadId: string): Promise<boolean> {
    const result = await getPostgresPool().query(
      `SELECT title_locked FROM ${qualifiedTable("thread_metadata")} WHERE thread_id = $1 LIMIT 1`,
      [threadId]
    );
    return result.rows[0]?.title_locked === true;
  }

  async verifyThreadAccess(threadId: string, userId: string, domainId: string): Promise<void> {
    const result = await getPostgresPool().query(
      `SELECT thread_id FROM ${qualifiedTable("thread_metadata")}
       WHERE thread_id = $1 AND user_id = $2 AND domain_id = $3`,
      [threadId, userId, domainId]
    );
    if ((result.rowCount ?? 0) === 0) {
      throw new HttpError(403, t("checkpointer.noAccess"));
    }
  }

  async verifyThreadDomain(threadId: string, domainId: string): Promise<void> {
    const result = await getPostgresPool().query(
      `SELECT thread_id FROM ${qualifiedTable("thread_metadata")} WHERE thread_id = $1 AND domain_id = $2`,
      [threadId, domainId]
    );
    if (!result.rows.length) throw new HttpError(403, t("checkpointer.noAccess"));
  }

  async getThreadMessages(
    threadId: string
  ): Promise<Array<{ role: "user" | "assistant"; content: string; requestSeq?: number }>> {
    try {
      const tuple = await this.getTuple({
        configurable: { thread_id: threadId },
      } as RunnableConfig);
      if (!tuple) return [];

      const checkpoint = tuple.checkpoint;
      const messagesData = checkpoint.channel_values?.messages;

      if (!messagesData || !Array.isArray(messagesData)) return [];

      const filtered: Array<{ role: "user" | "assistant"; content: string; requestSeq?: number }> =
        [];
      for (const m of messagesData) {
        if (!m) continue;

        const msgType = m.type || (Array.isArray(m.id) ? m.id[m.id.length - 1] : undefined);
        if (msgType === "ToolMessage") continue;

        if (msgType === "AIMessageChunk" || msgType === "ai") {
          const content = typeof m.content === "string" ? m.content : "";
          if (content.trim().startsWith("{") && !content.includes("```")) continue;
          filtered.push(toThreadMessage("assistant", content, m));
          continue;
        }

        if (m.type === "human" || msgType === "HumanMessage") {
          const content = typeof m.content === "string" ? m.content : "";
          filtered.push(toThreadMessage("user", content, m));
          continue;
        }

        if (m.role === "user") {
          const content = typeof m.content === "string" ? m.content : "";
          filtered.push(toThreadMessage("user", content, m));
        } else {
          const content = typeof m.content === "string" ? m.content : "";
          filtered.push(toThreadMessage("assistant", content, m));
        }
      }

      return filtered;
    } catch (e) {
      logger.error(tApp("foundation.log.checkpointer.parseFailed"), { threadId, error: String(e) });
      return [];
    }
  }

  /**
   * Writes the thread's conversation message channel.
   *
   * Thread messages are the checkpoint's `messages` channel; graph-driven runs have LangGraph write it along the way.
   * Runs that never enter a graph (dimension-form deep analysis) write the same channel explicitly here, keeping `getThreadMessages`'
   * read path unchanged. Other channels carry over from the previous checkpoint and are not wiped by this write.
   */
  async putThreadMessages(threadId: string, messages: BaseMessage[]): Promise<void> {
    const previous = await this.getTuple({
      configurable: { thread_id: threadId },
    } as RunnableConfig);
    const previousCheckpoint = previous?.checkpoint;

    const checkpoint: Checkpoint = emptyCheckpoint();
    // The channel version uses this checkpoint id so the checkpoint row and the blob row point at the same messages.
    const messagesVersion = checkpoint.id;
    checkpoint.channel_values = {
      ...(previousCheckpoint?.channel_values || {}),
      messages,
    };
    checkpoint.channel_versions = {
      ...(previousCheckpoint?.channel_versions || {}),
      messages: messagesVersion,
    };
    checkpoint.versions_seen = previousCheckpoint?.versions_seen || {};

    await this.put(
      { configurable: { thread_id: threadId, checkpoint_ns: "" } },
      checkpoint,
      { source: "update", step: -1, parents: {} },
      { messages: messagesVersion }
    );
  }

  async getThreadChannelValue<T>(threadId: string, channelName: string): Promise<T | undefined> {
    try {
      const tuple = await this.getTuple({
        configurable: { thread_id: threadId },
      } as RunnableConfig);
      return tuple?.checkpoint?.channel_values?.[channelName] as T | undefined;
    } catch (e) {
      logger.error(tApp("foundation.log.checkpointer.readFailed"), {
        threadId,
        channelName,
        error: String(e),
      });
      return undefined;
    }
  }

  async deleteThreadRecoveryData(threadId: string): Promise<void> {
    await this.deleteThread(threadId);
    logger.info(tApp("foundation.log.checkpointer.threadDeleted"), { threadId });
  }
}
