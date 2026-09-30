import type {
  AnalysisActivity,
  AnalysisEvidenceQuestion,
} from "@ontomato/contracts/analysis-presentation";
import { workbenchContent } from "../../../content";

type Translate = (key: string, params?: Record<string, unknown>) => string;

/** Activity kinds are exhaustively aligned with their display text. */
const ACTIVITY_LABEL_KEYS: Record<AnalysisActivity["kind"], string> = {
  plan: "analysis.frameworkGeneration",
  skill: "analysis.loopActivitySkill",
  evidence: "analysis.loopActivityEvidence",
  narrative: "analysis.loopActivityNarrative",
  chapter: "analysis.loopActivityChapter",
  publish: "analysis.loopActivityPublish",
  chart: "analysis.loopActivityChart",
  dispatch: "analysis.loopActivityDispatch",
  probe: "analysis.loopActivityProbe",
  external_tool: "analysis.loopActivityExternalTool",
};

/** Activity titles are localized by the shared contract kind. */
export function loopActivityLabel(activity: AnalysisActivity, t: Translate): string {
  return t(ACTIVITY_LABEL_KEYS[activity.kind]);
}

/**
 * Activity summary: evidence activities give the number of query questions, dispatch activities
 * give the topic, chart activities give the chart count, chapter-writing and finalization
 * activities give the chapter name, and failed activities give the reason.
 */
export function loopActivityDetail(activity: AnalysisActivity, t: Translate): string {
  const status =
    activity.status === "running"
      ? t("common.inProgress")
      : activity.status === "failed"
        ? t("common.failed")
        : activity.status === "cancelled"
          ? t("common.stopped")
          : t("analysis.completed");
  if (activity.kind === "external_tool") {
    const detail = t("analysis.loopExternalToolDetail", {
      service: activity.serviceName || "-",
      tool: activity.toolName || "-",
      status,
    });
    return activity.error ? `${detail} · ${activity.error}` : detail;
  }
  if (activity.kind === "probe") {
    const detail = t("analysis.loopProbeDetail", {
      tool: activity.probeTool || "-",
      arguments: JSON.stringify(activity.probeArguments || {}),
      status,
    });
    return activity.error ? `${detail} · ${activity.error}` : detail;
  }
  if (activity.error) return activity.error;
  if (activity.skills?.length)
    return activity.skills.map((s) => `${s.skillId}${s.entry ? ` · ${s.entry}` : ""}`).join(workbenchContent().skillListSeparator);
  if (activity.kind === "narrative") return activity.narrative?.trim() || "";
  if (activity.questions?.length) {
    return t("analysis.loopQuestionCount", { n: activity.questions.length });
  }
  if (activity.topic) return activity.topic;
  if (activity.charts?.length) {
    return t("analysis.loopChartCount", { n: activity.charts.length });
  }
  if (activity.chapter) return activity.chapter;
  return "";
}

/** Query question status text: a single question's failure reason stays on that question, not escalated to an activity failure. */
export function loopQuestionStatusText(question: AnalysisEvidenceQuestion, t: Translate): string {
  // Failure reason and row count are both execution-fact fields, read from the same place.
  if (question.status === "failed") {
    return question.execution?.error || question.error || t("analysis.queryFailed");
  }
  if (question.status === "cancelled") return t("common.stopped");
  if (question.status === "pending") return t("analysis.queryPending");
  if (question.status === "running") return t("analysis.querying");
  return t("analysis.rowCountHint", {
    n: question.execution?.dataCount ?? question.dataCount ?? 0,
  });
}
