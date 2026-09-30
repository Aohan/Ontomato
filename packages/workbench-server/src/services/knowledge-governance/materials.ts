import { z } from "zod";
import { config } from "../../config/application";
import { backendGet, backendPost } from "../../utils/backend-client";
import { getCheckpointer } from "../../infrastructure/connection";
import { getThreadMessagesPayload } from "../chat/thread-service";
import { buildTurnKey } from "../../logging/log-context";

export interface GovernanceCredentials {
  token: string;
  apiKey: string;
  domainId: string;
}
export interface Material {
  id: string;
  title: string;
  text: string;
}

const knowledgeSchema = z.object({
  knowledgeID: z.string().min(1),
  knowledgeTitle: z.string(),
  knowledgeText: z.string(),
  knowledgeTags: z.array(z.string()).nullish(),
  status: z.number().optional(),
  creatorType: z.number().optional(),
  modifyTime: z.unknown().optional(),
});

function unwrap(text: string): unknown {
  const response = z.object({ success: z.boolean(), data: z.unknown() }).parse(JSON.parse(text));
  if (!response.success) throw new Error("Source service rejected the read request");
  return response.data;
}

export async function readKnowledge(
  credentials: GovernanceCredentials,
  signal?: AbortSignal
): Promise<Material[]> {
  signal?.throwIfAborted();
  const endpoint = "/admin/getBussinessKnowledge";
  const response = await backendPost(
    endpoint,
    `${config.dataQuery.baseUrl}${endpoint}`,
    {},
    { ...credentials, signal }
  );
  const raw = unwrap(response.text);
  const entries = z
    .array(knowledgeSchema)
    .parse(Array.isArray(raw) ? raw : Object.values(z.record(z.unknown()).parse(raw)));
  return entries
    .map((item) => ({
      id: item.knowledgeID,
      title: item.knowledgeTitle,
      text: JSON.stringify(item, null, 2),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export async function readOntology(
  credentials: GovernanceCredentials,
  signal?: AbortSignal
): Promise<Material[]> {
  signal?.throwIfAborted();
  const endpoint = "/admin/getSchema";
  const response = await backendGet(endpoint, `${config.dataQuery.baseUrl}${endpoint}`, {
    ...credentials,
    signal,
  });
  // AdminServiceImpl.getPrettyJSONRule owns this external format: named class
  // definitions in an array, named relationships in an object.
  const schema = z
    .object({
      classDefs: z.array(z.object({ name: z.string().min(1) }).passthrough()),
      relationshipDefs: z.record(z.unknown()),
      datasetDesc: z.unknown().optional(),
      classList: z.unknown().optional(),
    })
    .parse(unwrap(response.text));
  return [
    ...schema.classDefs.map((value) => ({
      id: `class/${value.name}`,
      title: value.name,
      text: JSON.stringify(value, null, 2),
    })),
    ...Object.entries(schema.relationshipDefs).map(([name, value]) => ({
      id: `relationship/${name}`,
      title: name,
      text: JSON.stringify(value, null, 2),
    })),
    {
      id: "dataset",
      title: "Dataset",
      text: JSON.stringify(
        { datasetDesc: schema.datasetDesc, classList: schema.classList },
        null,
        2
      ),
    },
  ].sort((a, b) => a.id.localeCompare(b.id));
}

export const materialPageInput = z.object({
  query: z.string().default(""),
  id: z.string().optional(),
  index: z.number().int().nonnegative().default(0),
  offset: z.number().int().nonnegative().default(0),
  maxChars: z.number().int().min(1000).max(20_000).default(12_000),
});

/** Content cursors never drop the tail of a long record. Search always sees all originals. */
export function materialPage(materials: Material[], raw: unknown) {
  const input = materialPageInput.parse(raw);
  const query = input.query.toLocaleLowerCase();
  const matches = materials.filter(
    (item) =>
      (!input.id || item.id === input.id) &&
      (!query || `${item.title}\n${item.text}`.toLocaleLowerCase().includes(query))
  );
  const items: Array<Material & { start: number; end: number; totalChars: number }> = [];
  let index = input.index,
    offset = input.offset,
    remaining = input.maxChars;
  if (offset && (!matches[index] || offset > matches[index]!.text.length))
    throw new Error("Source changed or cursor is out of range; reread from offset 0");
  while (index < matches.length && remaining > 0) {
    const original = matches[index]!;
    const end = Math.min(original.text.length, offset + remaining);
    items.push({
      ...original,
      text: original.text.slice(offset, end),
      start: offset,
      end,
      totalChars: original.text.length,
    });
    remaining -= end - offset;
    if (end >= original.text.length) {
      index++;
      offset = 0;
    } else {
      offset = end;
      break;
    }
  }
  return {
    items,
    totalItems: materials.length,
    matchedItems: matches.length,
    next: index < matches.length ? { index, offset } : null,
  };
}

export async function readHistory(threadId: string, domainId: string) {
  const payload = await getThreadMessagesPayload(threadId, { scope: "domain", domainId });
  return {
    ...payload,
    threadId,
    turns: payload.messages.flatMap((message) =>
      typeof message.requestSeq === "number"
        ? [{ requestSeq: message.requestSeq, turnKey: buildTurnKey(threadId, message.requestSeq) }]
        : []
    ),
  };
}

export async function searchHistory(
  domainId: string,
  query: string,
  offset: number,
  limit: number,
  signal?: AbortSignal
) {
  signal?.throwIfAborted();
  const checkpointer = getCheckpointer();
  if (!checkpointer) throw new Error("Thread storage unavailable");
  const page = await checkpointer.getThreadList({ domainId, scope: "domain", offset, limit });
  const matches = [];
  for (const thread of page.threads) {
    signal?.throwIfAborted();
    const history = await readHistory(thread.threadId, domainId);
    const questions = history.messages
      .filter((message) => message.role === "user" && typeof message.content === "string")
      .filter(
        (message) =>
          !query || String(message.content).toLocaleLowerCase().includes(query.toLocaleLowerCase())
      )
      .map((message) => ({
        question: message.content,
        requestSeq: message.requestSeq,
        ...(typeof message.requestSeq === "number"
          ? { turnKey: buildTurnKey(thread.threadId, message.requestSeq) }
          : {}),
      }));
    if (questions.length || thread.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
      matches.push({ ...thread, questions });
  }
  const scannedTo = offset + page.threads.length;
  return {
    matches,
    totalThreads: page.total,
    scannedFrom: offset,
    scannedTo,
    nextOffset: scannedTo < page.total ? scannedTo : null,
  };
}
