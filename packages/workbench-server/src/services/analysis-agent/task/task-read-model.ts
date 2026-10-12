import type { EgressMessage } from "@ontomato/contracts/agent-egress";
import type { AnalysisEvidenceQuestion } from "@ontomato/contracts/analysis-presentation";
import type { AnalysisTask as ClientAnalysisTask, LoopSubagentTrace } from "@ontomato/contracts/analysis-task";
import { toEgressMessages } from "../../../core/agent-loop/index";
import { getQueryRunBySource, type QueryRun } from "../../data-query/query-run-store";
import { toDisplayFact, toQueryExecutionFact } from "../../data-query/query-fact";
import type { QueryExecutionDisplayFact } from "@ontomato/contracts/query-execution";
import { ANALYSIS_SUB_QUESTION_SOURCE_KIND } from "../../../logging/log-context";
import type { AnalysisTask, AnalysisLoopSubagentAudit } from "../task-types";
import { tApp } from "../../../i18n";


/** Task metadata exit: artifacts, run history and internal identity are read through their own APIs. */
export function toClientTask(task: AnalysisTask): ClientAnalysisTask {
  const {
    analysisPayload: _analysisPayload,
    runHistory: _runHistory,
    token: _token,
    requestSeq: _requestSeq,
    domainId: _domainId,
    ...clientTask
  } = task;
  return clientTask;
}

/** On top of the base exit view, only the probing-body policy owned by the analysis business is layered. */
export function toSubagentAuditEgress(audit: AnalysisLoopSubagentAudit): LoopSubagentTrace {
  return {
    ...audit,
    messages: toEgressMessages(audit.messages, {
      thinking: "omit",
      toolResultContent: "full",
    }).map((message): EgressMessage => {
      if (message.role === "toolResult") {
        if (message.toolName === "probe_classes" || message.toolName === "probe_class_data") {
          return {
            ...message,
            content: [{ type: "text", text: tApp("analysis.task.task-read-model.412") }],
          };
        }
      }
      return message;
    }),
  };
}

/**
 * Overlays the question's query run (read by its own thread, acceptance sequence and stable ID) onto its stored
 * execution. Without a run the stored facts stay as they are — no DSL, data, or success conclusion is ever invented.
 */
export function mergeQueryRunExecution(
  question: Pick<AnalysisEvidenceQuestion, "execution" | "dataCount" | "error">,
  run: QueryRun | null
): QueryExecutionDisplayFact {
  return {
    ...question.execution,
    ...(run ? toDisplayFact(toQueryExecutionFact(run)) : {}),
    dataCount: run?.dataCount ?? question.dataCount ?? 0,
    error: question.error || run?.error || undefined,
  };
}

export function readQuestionQueryRun(
  scope: { threadId?: string; requestSeq?: number },
  questionId: string
): Promise<QueryRun | null> {
  const { threadId, requestSeq } = scope;
  return threadId && requestSeq !== undefined
    ? getQueryRunBySource({
        threadId,
        requestSeq,
        sourceKind: ANALYSIS_SUB_QUESTION_SOURCE_KIND,
        sourceRef: questionId,
      })
    : Promise.resolve(null);
}
