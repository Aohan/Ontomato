import { createHash } from "node:crypto";
import { z } from "zod";
import {
  governanceIssueSchema,
  type GovernanceSource,
} from "@ontomato/contracts/knowledge-governance";
import type { AgentTool } from "../../core/agent-loop/types";
import { getCheckpointer } from "../../infrastructure/connection";
import { parseTurnKey } from "../../logging/log-context";
import { createCollectTurnArtifactsTool } from "../../platform/diagnosis/observe/agent/tools/collect-turn-artifacts-tool";
import {
  getFileTree,
  readWorkspaceFile,
} from "../../platform/diagnosis/observe/workspaces/artifact-file";
import { loadManifest } from "../../platform/diagnosis/observe/workspaces/store";
import {
  materialPage,
  materialPageInput,
  readKnowledge,
  readOntology,
  readHistory,
  searchHistory,
  type GovernanceCredentials,
} from "./materials";
import type { GovernanceRecord } from "./store";

const pageProperties = {
  query: {
    type: "string",
    description: "Text to match across ALL originals, including unread records.",
  },
  id: { type: "string", description: "Optional exact original identity." },
  index: { type: "integer", minimum: 0 },
  offset: { type: "integer", minimum: 0 },
  maxChars: { type: "integer", minimum: 1000, maximum: 20000 },
};
const result = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value) }],
});

export function sourceId(kind: GovernanceSource["kind"], target: string) {
  return createHash("sha256").update(`${kind}:${target}`).digest("hex").slice(0, 20);
}

export function createGovernanceTools(
  record: GovernanceRecord,
  credentials: GovernanceCredentials,
  persist: () => Promise<void>
): AgentTool[] {
  const remember = (
    kind: GovernanceSource["kind"],
    target: string,
    title: string,
    excerpt: string
  ) => {
    const id = sourceId(kind, target);
    if (!record.work.sources.some((source) => source.id === id))
      record.work.sources.push({ id, kind, target, title, excerpt: excerpt.slice(0, 1200) });
    return id;
  };
  const readMaterials = (kind: "knowledge" | "ontology"): AgentTool => ({
    name: `read_${kind}`,
    description: `Read current domain ${kind} originals by character budget. Follow next.index/offset to read every character. Query searches ALL records. Returned sourceId can be cited in findings.`,
    parameters: { type: "object", properties: pageProperties },
    executionMode: "sequential",
    async execute(_id, args, signal) {
      const materials = await (kind === "knowledge"
        ? readKnowledge(credentials, signal)
        : readOntology(credentials, signal));
      signal?.throwIfAborted();
      if (kind === "knowledge") record.work.knowledgeTotal = materials.length;
      const page = materialPage(materials, args);
      const items = page.items.map((item) => ({
        ...item,
        sourceId: remember(kind, item.id, item.title, item.text),
      }));
      await persist();
      return result({ ...page, items });
    },
  });
  return [
    readMaterials("knowledge"),
    readMaterials("ontology"),
    {
      name: "search_history",
      description:
        "Find relevant questions in a PAGE of all current-domain users' conversations, including those without diagnostic artifacts. Text matching is literal; choose expansions and additional pages yourself. Empty matches only describes scannedFrom..scannedTo, not all history.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          offset: { type: "integer", minimum: 0 },
          limit: { type: "integer", minimum: 1, maximum: 20 },
        },
      },
      async execute(_id, args, signal) {
        const input = z
          .object({
            query: z.string().default(""),
            offset: z.number().int().nonnegative().default(0),
            limit: z.number().int().min(1).max(20).default(10),
          })
          .parse(args);
        return result(
          await searchHistory(record.domainId, input.query, input.offset, input.limit, signal)
        );
      },
    },
    {
      name: "read_history",
      description:
        "Read the shared history payload for a current-domain conversation. Paginate by character offset; turns supplies stable turnKey for optional diagnostic collection. System output is execution evidence, not business truth.",
      parameters: {
        type: "object",
        properties: {
          threadId: { type: "string" },
          offset: { type: "integer", minimum: 0 },
          maxChars: { type: "integer", minimum: 1000, maximum: 20000 },
        },
        required: ["threadId"],
      },
      executionMode: "sequential",
      async execute(_id, args, signal) {
        signal?.throwIfAborted();
        const { threadId } = z.object({ threadId: z.string().min(1) }).parse(args);
        const history = await readHistory(threadId, record.domainId);
        const text = JSON.stringify(history, null, 2);
        const page = materialPage([{ id: threadId, title: threadId, text }], args);
        signal?.throwIfAborted();
        const id = remember(
          "history",
          threadId,
          threadId,
          history.messages
            .filter((m) => m.role === "user")
            .map((m) => m.content)
            .join("\n")
        );
        await persist();
        return result({ ...page, sourceId: id, turns: history.turns });
      },
    },
    createCollectTurnArtifactsTool({
      domainId: credentials.domainId,
      token: credentials.token,
      apiKey: credentials.apiKey,
    }),
    {
      name: "read_evidence",
      description:
        "Read existing diagnostic artifacts of a current-domain turn using the diagnosis file reader. Omit path to list files; provide path and offset to read the full original in parts. Missing artifacts are an evidence gap. Never print raw prompts in the user conversation.",
      parameters: {
        type: "object",
        properties: {
          turnKey: { type: "string" },
          path: { type: "string" },
          offset: { type: "integer", minimum: 0 },
          maxChars: { type: "integer", minimum: 1000, maximum: 20000 },
        },
        required: ["turnKey"],
      },
      executionMode: "sequential",
      async execute(_id, args, signal) {
        signal?.throwIfAborted();
        const { turnKey, path } = z
          .object({ turnKey: z.string(), path: z.string().optional() })
          .parse(args);
        const turn = parseTurnKey(turnKey);
        if (!turn) throw new Error("Invalid turnKey");
        const manifest = loadManifest(turnKey);
        if (!manifest) {
          const checkpointer = getCheckpointer();
          if (!checkpointer) throw new Error("Thread storage unavailable");
          await checkpointer.verifyThreadDomain(turn.threadId, record.domainId);
          return result({ evidenceGap: "No diagnostic workspace exists for this turn." });
        }
        if (manifest.domainId !== record.domainId)
          throw new Error("Diagnostic artifact belongs to another domain");
        if (!path) return result({ tree: getFileTree(turnKey), status: manifest.status });
        const text = readWorkspaceFile(turnKey, path);
        if (text === null)
          return result({
            evidenceGap:
              "Artifact unavailable; absence does not prove the knowledge was absent from the original input.",
          });
        const id = remember("artifact", `${turnKey}/${path}`, path, "");
        signal?.throwIfAborted();
        await persist();
        return result({ ...materialPage([{ id, title: path, text }], args), sourceId: id });
      },
    },
    {
      name: "read_work_record",
      description:
        "Read the persistent work record, reviewed identities, sources and issues after compaction or resuming. Follow offsets to recover all content; summaries never replace originals.",
      parameters: { type: "object", properties: pageProperties },
      async execute(_id, args) {
        return result(
          materialPage(
            [{ id: record.id, title: "Work record", text: JSON.stringify(record.work, null, 2) }],
            args
          )
        );
      },
    },
    {
      name: "update_work_record",
      description:
        "Save ONLY this governance round's progress, notes and report findings. reviewedKnowledgeIds adds completed original identities. issues upserts by stable issue id: merge the same business dispute across batches. Cite returned sourceIds. Human confirmation updates recommendations only; it never changes production knowledge, ontology or data. Omitted fields retain current content.",
      executionMode: "sequential",
      parameters: {
        type: "object",
        properties: {
          summary: {
            type: "string",
            description: "Short business-language progress shown on the page.",
          },
          notes: {
            type: "string",
            description:
              "Replace durable notes with current coverage, associations, pending meanings and next work. Keep original IDs.",
          },
          reviewedKnowledgeIds: { type: "array", items: { type: "string" } },
          issues: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                title: { type: "string" },
                category: { type: "string", enum: ["ontology", "knowledge", "data"] },
                status: { type: "string", enum: ["proposed", "pending", "confirmed"] },
                problem: { type: "string" },
                before: { type: "string" },
                after: { type: "string" },
                basis: { type: "string" },
                sourceIds: { type: "array", items: { type: "string" } },
              },
              required: [
                "id",
                "title",
                "category",
                "status",
                "problem",
                "before",
                "after",
                "basis",
                "sourceIds",
              ],
            },
          },
        },
      },
      async execute(_id, args, signal) {
        signal?.throwIfAborted();
        const patch = z
          .object({
            summary: z.string().max(1000).optional(),
            notes: z.string().max(30_000).optional(),
            reviewedKnowledgeIds: z.array(z.string()).optional(),
            issues: z.array(governanceIssueSchema).optional(),
          })
          .parse(args);
        for (const issue of patch.issues || []) {
          if (issue.sourceIds.some((id) => !record.work.sources.some((source) => source.id === id)))
            throw new Error("Read the cited original before referencing its sourceId");
        }
        if (patch.summary !== undefined) record.work.summary = patch.summary;
        if (patch.notes !== undefined) record.work.notes = patch.notes;
        record.work.reviewedKnowledgeIds = [
          ...new Set([...record.work.reviewedKnowledgeIds, ...(patch.reviewedKnowledgeIds || [])]),
        ];
        for (const issue of patch.issues || []) {
          const index = record.work.issues.findIndex((existing) => existing.id === issue.id);
          if (index < 0) record.work.issues.push(issue);
          else record.work.issues[index] = issue;
        }
        await persist();
        return result({
          saved: true,
          reviewed: record.work.reviewedKnowledgeIds.length,
          issues: record.work.issues.length,
        });
      },
    },
  ];
}

/** User-facing original reads expose business materials, never diagnostic prompts or tool dumps. */
export async function readGovernanceSource(
  record: GovernanceRecord,
  credentials: GovernanceCredentials,
  id: string,
  offset: number
) {
  const source = record.work.sources.find((item) => item.id === id);
  if (!source) throw new Error("Source not found");
  if (source.kind === "artifact") return { source, page: null };
  const materials =
    source.kind === "knowledge"
      ? await readKnowledge(credentials)
      : source.kind === "ontology"
        ? await readOntology(credentials)
        : [
            {
              id: source.target,
              title: source.title,
              text: JSON.stringify(await readHistory(source.target, record.domainId), null, 2),
            },
          ];
  return {
    source,
    page: materialPage(materials, materialPageInput.parse({ id: source.target, offset })),
  };
}
