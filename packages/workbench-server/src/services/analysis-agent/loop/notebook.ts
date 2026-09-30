/**
 * Report notebook of the loop form.
 *
 * The notebook is the working carrier of the task body and the only writing channel of the loop form: one file per constituent part, stored in
 * the task's working directory, with the final report assembled in filename order. Constituent parts and the report's semantic chapters need not
 * correspond one-to-one — one part may contain several chapters and one chapter may be split across parts; the supervisor decides the split.
 * `chapter` below is only the implementation name of this file unit and does not imply one semantic chapter.
 * The writing tools reuse the semantics of the existing base file tools (whole-file write/overwrite, unique-match partial edit, read-back,
 * directory listing) wrapped in a layer that pins the operable range inside the task working directory; out-of-bounds access is deterministically rejected.
 *
 * Files are only the working carrier: the final assembled output is written into the single authoritative store of the task report artifact, and the working directory can be cleaned up.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AgentTool, AgentToolResult } from "../../../core/agent-loop/types";
import { createLogger } from "../../../logging/logger";
import type { DeepAnalysisArtifactStore } from "../task/artifacts";
import { tApp } from "../../../i18n";


const logger = createLogger("analysis-loop-notebook");

/** Parent directory of all task notebooks; each task owns its own working directory beneath it. */
const NOTEBOOK_ROOT = path.join(os.tmpdir(), "analysis-loop-notebook");

/** Assembly separator between chapters. */
const CHAPTER_SEPARATOR = "\n\n";

function reportDeliverableCapabilityPrompt(): string {
  return [
  tApp("analysis.loop.notebook.271"),
  tApp("analysis.loop.notebook.272"),
  tApp("analysis.loop.notebook.273"),
  "",
  tApp("analysis.loop.notebook.274"),
  tApp("analysis.loop.notebook.275"),
  "",
  tApp("analysis.loop.notebook.276"),
  tApp("analysis.loop.notebook.277"),
  tApp("analysis.loop.notebook.278"),
  tApp("analysis.loop.notebook.279"),
  tApp("analysis.loop.notebook.280"),
  "",
  tApp("analysis.loop.notebook.281"),
  tApp("analysis.loop.notebook.282"),
  tApp("analysis.loop.notebook.283"),
  "",
].join("\n");
}

function finalAnswerCapabilityPrompt(): string {
  return [
  tApp("analysis.loop.notebook.284"),
  "",
  tApp("analysis.loop.notebook.285"),
  tApp("analysis.loop.notebook.286"),
  tApp("analysis.loop.notebook.287"),
  "",
  tApp("analysis.loop.notebook.288"),
  tApp("analysis.loop.notebook.289"),
  tApp("analysis.loop.notebook.290"),
  "",
].join("\n");
}

function reportWorkerCapabilityPrompt(): string {
  return [
  tApp("analysis.loop.notebook.272"),
  "",
  tApp("analysis.loop.notebook.291"),
  "",
  tApp("analysis.loop.notebook.292"),
  tApp("analysis.loop.notebook.293"),
  tApp("analysis.loop.notebook.280"),
  tApp("analysis.loop.notebook.294"),
  tApp("analysis.loop.notebook.295"),
].join("\n");
}

function finalAnswerWorkerCapabilityPrompt(): string {
  return tApp("analysis.loop.notebook.296");
}

export interface NotebookChapter {
  name: string;
  content: string;
  published: boolean;
}

export interface ReportNotebook {
  /** This task's working directory */
  readonly rootDir: string;
  /**
   * Resolves a chapter name to a file path inside the working directory. Out-of-bounds names (path separators, parent directories, absolute
   * paths) are deterministically rejected, returning the rejection reason instead of a path.
   */
  resolve(name: unknown): { filePath: string } | { rejected: string };
  /** All chapters, in filename order */
  chapters(): NotebookChapter[];
  /** Marks one chapter as finalized */
  markPublished(name: string): void;
  /** Assembles finalized non-empty chapters as a whole, in filename order */
  assemblePublished(): string;
  /** Assembles all non-empty chapters as a whole, in filename order (terminal-state fallback: content is never lost to a missed finalization) */
  assembleAll(): string;
  /** Cleans up the task working directory */
  dispose(): void;
}

function buildCompactionPromptVariables(reportDeliverableEnabled: boolean): Record<string, string> {
  return {
    reportDeliverableSystemContext: reportDeliverableEnabled
      ? [
          "Do not write or reproduce report chapters.",
          "Preserve chapter file names and chapter status.",
          "The report body lives in the report notebook, not in this conversation: record which chapters exist and what still has to happen to them, never their full text — the agent reads a chapter back with its notebook tools.",
        ].join("\n")
      : "",
    reportDeliverableCheckpointSection: reportDeliverableEnabled
      ? [
          "## Notebook Chapters",
          "- [chapter file name | written or dispatched or planned | published or not | one line on what it covers.]",
        ].join("\n")
      : "",
    reportDeliverablePreservationInstruction: reportDeliverableEnabled
      ? "Do not reproduce chapter text — the chapters are on disk and can be read back with the notebook tools. Preserve exact chapter file names and chapter status."
      : "",
  };
}

/** Assembles prompts, supervisor/worker tool surfaces, and trajectory/SSE wiring for the report deliverable (or final-reply path). */
export function assembleLoopNotebookCapability(params: {
  reportDeliverableEnabled: boolean;
  dirKey: string;
  trajectory: DeepAnalysisArtifactStore;
}) {
  const notebook = params.reportDeliverableEnabled
    ? createReportNotebook(params.dirKey)
    : undefined;

  const recordChapterActivity = (
    kind: "chapter" | "publish",
    chapter: string,
    dispatchId?: string
  ) => {
    const activityId = params.trajectory.start(kind, {
      chapter,
      ...(dispatchId ? { dispatchId } : {}),
    });
    params.trajectory.settle(activityId, "completed", { chapter });
  };

  const createTools = (dispatchId?: string): AgentTool[] =>
    notebook
      ? createNotebookTools({
          notebook,
          onChapterWritten: (chapter) => recordChapterActivity("chapter", chapter, dispatchId),
        })
      : [];

  const supervisorTools = createTools();
  if (notebook) {
    supervisorTools.push(
      createPublishChapterTool({
        notebook,
        onPublished: (chapter) => {
          recordChapterActivity("publish", chapter);
          params.trajectory.section({
            sectionId: "report",
            markdown: notebook.assemblePublished(),
            mode: "replace",
          });
        },
      })
    );
  }

  return {
    supervisorPrompt: params.reportDeliverableEnabled
      ? reportDeliverableCapabilityPrompt()
      : finalAnswerCapabilityPrompt(),
    workerPrompt: params.reportDeliverableEnabled
      ? reportWorkerCapabilityPrompt()
      : finalAnswerWorkerCapabilityPrompt(),
    completionInstruction: params.reportDeliverableEnabled
      ? tApp("analysis.loop.notebook.297")
      : tApp("analysis.loop.notebook.298"),
    compactionPromptVariables: buildCompactionPromptVariables(params.reportDeliverableEnabled),
    notebook,
    supervisorTools,
    createWorkerTools: (dispatchId: string) => createTools(dispatchId),
  };
}

export function createReportNotebook(dirKey: string): ReportNotebook {
  const rootDir = path.join(NOTEBOOK_ROOT, dirKey.replace(/[^A-Za-z0-9_-]/g, "_"));
  fs.mkdirSync(rootDir, { recursive: true });
  const published = new Set<string>();

  const chapters = (): NotebookChapter[] =>
    fs
      .readdirSync(rootDir)
      .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
      .map((name) => ({
        name,
        content: fs.readFileSync(path.join(rootDir, name), "utf-8"),
        published: published.has(name),
      }));

  const assemble = (keep: (chapter: NotebookChapter) => boolean): string =>
    chapters()
      .filter((chapter) => chapter.content.trim() && keep(chapter))
      .map((chapter) => chapter.content.trim())
      .join(CHAPTER_SEPARATOR);

  return {
    rootDir,

    resolve(name: unknown) {
      const chapter = typeof name === "string" ? name.trim() : "";
      if (!chapter) return { rejected: tApp("analysis.loop.notebook.299") };
      const filePath = path.resolve(rootDir, chapter);
      if (path.dirname(filePath) !== rootDir) {
        return {
          rejected: tApp("analysis.loop.notebook.300", { chapter: chapter }),
        };
      }
      return { filePath };
    },

    chapters,

    markPublished(name: string) {
      published.add(name);
    },

    assemblePublished: () => assemble((chapter) => chapter.published),

    assembleAll: () => assemble(() => true),

    dispose() {
      try {
        fs.rmSync(rootDir, { recursive: true, force: true });
      } catch (error: unknown) {
        logger.error(tApp("analysis.loop.notebook.301"), {
          rootDir,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  };
}

function textResult(text: string): AgentToolResult {
  return { content: [{ type: "text", text }] };
}

/**
 * Notebook read/write tools: supervisor and workers share one set (the tool set is the permission; the finalization tool is not included).
 * `onChapterWritten` registers chapter writing into the analysis trajectory.
 */
export function createNotebookTools(params: {
  notebook: ReportNotebook;
  onChapterWritten: (chapter: string) => void;
}): AgentTool[] {
  const { notebook } = params;

  return [
    {
      name: "write_chapter",
      description:
        tApp("analysis.loop.notebook.302"),
      parameters: {
        type: "object",
        properties: {
          chapter: {
            type: "string",
            description: tApp("analysis.loop.notebook.303"),
          },
          content: { type: "string", description: tApp("analysis.loop.notebook.304") },
        },
        required: ["chapter", "content"],
      },
      async execute(_toolCallId: string, toolParams: Record<string, unknown>) {
        const resolved = notebook.resolve(toolParams.chapter);
        if ("rejected" in resolved) return textResult(resolved.rejected);
        const content = typeof toolParams.content === "string" ? toolParams.content : "";
        if (!content.trim()) return textResult(tApp("analysis.loop.notebook.305"));

        const chapter = path.basename(resolved.filePath);
        fs.writeFileSync(resolved.filePath, content, "utf-8");
        params.onChapterWritten(chapter);
        return textResult(tApp("analysis.loop.notebook.306", { chapter: chapter, length: content.length }));
      },
    },

    {
      name: "edit_chapter",
      description:
        tApp("analysis.loop.notebook.307"),
      parameters: {
        type: "object",
        properties: {
          chapter: { type: "string", description: tApp("analysis.loop.notebook.308") },
          old_string: { type: "string", description: tApp("analysis.loop.notebook.309") },
          new_string: { type: "string", description: tApp("analysis.loop.notebook.310") },
        },
        required: ["chapter", "old_string", "new_string"],
      },
      async execute(_toolCallId: string, toolParams: Record<string, unknown>) {
        const resolved = notebook.resolve(toolParams.chapter);
        if ("rejected" in resolved) return textResult(resolved.rejected);

        const chapter = path.basename(resolved.filePath);
        if (!fs.existsSync(resolved.filePath)) {
          return textResult(
            tApp("analysis.loop.notebook.311", { chapter: chapter })
          );
        }

        const oldString = String(toolParams.old_string ?? "");
        const newString = String(toolParams.new_string ?? "");
        const content = fs.readFileSync(resolved.filePath, "utf-8");
        const first = content.indexOf(oldString);
        if (!oldString || first < 0) {
          return textResult(tApp("analysis.loop.notebook.312", { chapter: chapter }));
        }
        if (content.indexOf(oldString, first + oldString.length) >= 0) {
          return textResult(
            tApp("analysis.loop.notebook.313", { chapter: chapter })
          );
        }

        fs.writeFileSync(
          resolved.filePath,
          content.slice(0, first) + newString + content.slice(first + oldString.length),
          "utf-8"
        );
        params.onChapterWritten(chapter);
        return textResult(tApp("analysis.loop.notebook.314", { chapter: chapter }));
      },
    },

    {
      name: "read_chapter",
      description: tApp("analysis.loop.notebook.315"),
      parameters: {
        type: "object",
        properties: {
          chapter: { type: "string", description: tApp("analysis.loop.notebook.316") },
        },
        required: ["chapter"],
      },
      async execute(_toolCallId: string, toolParams: Record<string, unknown>) {
        const resolved = notebook.resolve(toolParams.chapter);
        if ("rejected" in resolved) return textResult(resolved.rejected);

        const chapter = path.basename(resolved.filePath);
        if (!fs.existsSync(resolved.filePath)) {
          return textResult(
            tApp("analysis.loop.notebook.311", { chapter: chapter })
          );
        }
        return textResult(fs.readFileSync(resolved.filePath, "utf-8"));
      },
    },

    {
      name: "list_chapters",
      description: tApp("analysis.loop.notebook.317"),
      parameters: { type: "object", properties: {} },
      async execute() {
        const chapters = notebook.chapters();
        if (chapters.length === 0) return textResult(tApp("analysis.loop.notebook.318"));
        return textResult(
          chapters
            .map(
              (chapter, index) =>
                tApp("analysis.loop.notebook.319", { value: index + 1, name: chapter.name, length: chapter.content.length, value2: chapter.published ? tApp("analysis.loop.notebook.320") : tApp("analysis.loop.notebook.321") })
            )
            .join("\n")
        );
      },
    },
  ];
}

/**
 * Per-chapter finalization tool: granted to the supervisor only. After finalization the runtime re-pushes the finalized chapters re-ordered as a
 * whole in chapter order, so the report area grows with each accepted chapter.
 */
export function createPublishChapterTool(params: {
  notebook: ReportNotebook;
  onPublished: (chapter: string) => void;
}): AgentTool {
  const { notebook } = params;

  return {
    name: "publish_chapter",
    description:
      tApp("analysis.loop.notebook.322"),
    parameters: {
      type: "object",
      properties: {
        chapter: { type: "string", description: tApp("analysis.loop.notebook.323") },
      },
      required: ["chapter"],
    },
    async execute(_toolCallId: string, toolParams: Record<string, unknown>) {
      const resolved = notebook.resolve(toolParams.chapter);
      if ("rejected" in resolved) return textResult(resolved.rejected);

      const chapter = path.basename(resolved.filePath);
      if (!fs.existsSync(resolved.filePath)) {
        return textResult(
          tApp("analysis.loop.notebook.324", { chapter: chapter })
        );
      }

      notebook.markPublished(chapter);
      params.onPublished(chapter);
      return textResult(tApp("analysis.loop.notebook.325", { chapter: chapter }));
    },
  };
}
