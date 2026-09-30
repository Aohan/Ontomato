import type {
  AnalysisActivity,
  DeepAnalysisTaskPayload,
} from "@ontomato/contracts/analysis-presentation";
import type { DeepAnalysisDimension, DeepAnalysisQuestion } from "../../../types/chat";

/** The plan provides the full question set, and evidence activities provide current status; failures and empty results are not pruned. */
export function buildDimensionTree(
  activities: readonly AnalysisActivity[]
): DeepAnalysisDimension[] {
  const plan = activities.find((a) => a.kind === "plan");
  return (plan?.dimensions || []).map((dimension) => {
    const evidence = activities.find(
      (a) => a.kind === "evidence" && a.groupId === dimension.dimensionId
    );
    const questions: DeepAnalysisQuestion[] = dimension.questions.map((question) => {
      const fact = evidence?.questions?.find((q) => q.questionId === question.questionId);
      return {
        id: question.questionId,
        text: question.question,
        done: fact?.status === "completed",
        status: fact?.status === "cancelled" ? "stopped" : fact?.status || "pending",
        statusText: fact?.error || fact?.statusText,
        execution: fact?.execution as DeepAnalysisQuestion["execution"],
      };
    });
    return {
      dimensionId: dimension.dimensionId,
      dimName: dimension.name,
      dimensionValue: dimension.value,
      reason: dimension.reason,
      status:
        evidence?.status === "cancelled"
          ? "stopped"
          : questions.every((q) => q.done)
            ? "completed"
            : questions.some((q) => q.done)
              ? "partial"
              : evidence?.status || "pending",
      questions,
    };
  });
}

/** Four-stage completion checks the global precondition; stopping falls on the first unsatisfied stage. */
export function dimensionStageStates(
  data: DeepAnalysisTaskPayload
): Array<"done" | "active" | "pending" | "stopped"> {
  const plan = data.activities.find((a) => a.kind === "plan");
  const dimensions = plan?.dimensions || [];
  const evidence = data.activities.filter((a) => a.kind === "evidence");
  const settled = (a: AnalysisActivity) => a.status === "completed" || a.status === "failed";
  const complete = [
    plan?.status === "completed",
    evidence.every(settled),
    data.activities
      .filter((a) => a.groupId && (a.kind === "skill" || a.kind === "chart"))
      .every(settled),
    dimensions.length > 0 &&
      dimensions.every((d) =>
        data.sections.some((s) => s.sectionId === d.dimensionId && s.status)
      ) &&
      data.sections.some((s) => s.sectionId === "summary" && s.status) &&
      data.activities.filter((a) => a.kind === "chapter").every(settled),
  ];
  const first = complete.findIndex((done) => !done);
  return complete.map((done, index) =>
    done && (first < 0 || index < first)
      ? "done"
      : index === first
        ? data.runState.status === "running"
          ? "active"
          : "stopped"
        : "pending"
  );
}
