/**
 * 循环形态的报告笔记本。
 *
 * 笔记本是本次任务的正文工作载体，也是循环形态唯一的写作通道：一个组成部分一个
 * 文件，存放在本次任务的工作目录，最终报告按文件名序拼成。组成部分与报告的语义
 * 章节不必一一对应——一个部分可以含多章，一章也可以拆成多个部分，怎么划分由主管
 * 裁量；下面的 `chapter` 只是这个文件单位的实现命名，不代表一个语义章节。
 * 写作工具复用既有基础文件工具的语义（整体写入/覆盖、按原文唯一匹配的局部修改、
 * 读回、列目录），外包一层把可操作范围钉死在任务工作目录内，越界访问确定性拒绝。
 *
 * 文件只是过程载体：终态组装产物写入任务报告产物的唯一权威存储，工作目录可清理。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AgentTool, AgentToolResult } from "../../../core/agent-loop/types";
import { createLogger } from "../../../logging/logger";
import type { DeepAnalysisArtifactStore } from "../task/artifacts";
import { tApp } from "../../../i18n";


const logger = createLogger("analysis-loop-notebook");

/** 所有任务笔记本的父目录；每个任务在其下拥有自己的工作目录。 */
const NOTEBOOK_ROOT = path.join(os.tmpdir(), "analysis-loop-notebook");

/** 章节之间的组装分隔。 */
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
  /** 本次任务的工作目录 */
  readonly rootDir: string;
  /**
   * 把章节名解析为工作目录内的文件路径。越界（路径分隔符、上级目录、绝对路径）
   * 确定性拒绝，返回拒绝原因而不是路径。
   */
  resolve(name: unknown): { filePath: string } | { rejected: string };
  /** 全部章节，按文件名序 */
  chapters(): NotebookChapter[];
  /** 把一章标记为已定稿 */
  markPublished(name: string): void;
  /** 已定稿的非空章节按文件名序整体组装 */
  assemblePublished(): string;
  /** 全部非空章节按文件名序整体组装（终态兜底：漏定稿也不丢内容） */
  assembleAll(): string;
  /** 清理任务工作目录 */
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

/** 装配报告交付件（或最终回复路径）的提示词、主管/工人工具面与轨迹/SSE 接线。 */
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
 * 笔记本读写工具：主管与工人共用同一套（工具集即权限，定稿工具不在其中）。
 * `onChapterWritten` 用于把章节写作登记进分析轨迹。
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
 * 按章定稿工具：只授予主管。定稿后运行时把已定稿章节按章节顺序整体重排推送，
 * 报告区随章节验收逐步生长。
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
