/**
 * 诊断工作区产物里的文本协议：提示词产物的分段标记与子查询文件名、
 * 后端取证说明与其失败判定、响应快照里折叠表格摘要的改写。
 * 两版各装迁出前的原值，不随请求语言变化；代码按语义键取值，不按显示词分支。
 */
import type { PromptTranscriptFormat } from "@ontomato/contracts/observe";

/** 提示词标记词与轮次标题识别规则归共享契约 PromptTranscriptFormat（观察页按同一对象阅读）。 */
export interface WorkspaceArtifactText extends PromptTranscriptFormat {
  /** 子查询 try 会话的提示词文件名片段：`-<词><子查询序号>-try-<n>`。 */
  subQueryFilenameWord: string;
  /**
   * 提示词产物的轮次标题。第二参只在 originalRound 与 round 不同时传入；
   * 省略时是普通轮次（序号取 originalRound ?? round）。
   */
  roundTitle(round: number, originalRound?: number): string;
  /**
   * 后端取证（agent-llm、diagnostic-events、backend.log）的说明文字。`…Failed` 后接外部错误详情；
   * 多条说明、多节点失败以 `separator` 连接。post_process_status 按 `failureMessagePattern`
   * 判定说明是否表示取回失败，文字与规则成对。
   */
  backendEvidence: {
    agentLlmEmpty: string;
    agentLlmFailed: string;
    diagnosticEventsEmpty: string;
    diagnosticEventsFailed: string;
    noSession: string;
    noLogWindow: string;
    logSliceFailed: string;
    logEmpty: string;
    separator: string;
    failureMessagePattern: RegExp;
  };
  /** 折叠表格摘要里的展开提示，改写为未写入快照的说明。 */
  foldedTableHint: { pattern: RegExp; replacement: string };
}

let installed: WorkspaceArtifactText | null = null;

export function installWorkspaceArtifactText(text: WorkspaceArtifactText): void {
  installed = text;
}

export function workspaceArtifactText(): WorkspaceArtifactText {
  if (!installed) throw new Error("Workspace artifact text is not installed");
  return installed;
}
