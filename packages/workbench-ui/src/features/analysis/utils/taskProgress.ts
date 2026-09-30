import type { AnalysisTaskDetail } from "@ontomato/contracts/analysis-task";
import type { ResponseSnapshot } from "../../../types/chat";
import type { TaskProgressState } from "../../workbench";

export function buildTaskProgressMap(
  tasks: AnalysisTaskDetail[],
  sessions: Record<
    string,
    {
      streamingSnapshot?: ResponseSnapshot | null;
      messages?: Array<{ snapshot?: ResponseSnapshot }>;
    }
  >,
  t: (key: string, params?: Record<string, unknown>) => string
): Record<string, TaskProgressState> {
  const map: Record<string, TaskProgressState> = {};
  for (const task of tasks) {
    const session = sessions[task.id];
    const data =
      session?.streamingSnapshot?.deepAnalysis ||
      [...(session?.messages || [])].reverse().find((m) => m.snapshot?.deepAnalysis)?.snapshot
        ?.deepAnalysis;
    const runState = data?.runState || task.runState;
    if (!runState) continue;
    const { done, total, label } = runState.progress;
    map[task.id] = {
      progress: total === undefined ? undefined : Math.round((100 * done) / total),
      stageText: total === undefined ? t("analysis.loopProgress", { done, label }) : label,
    };
  }
  return map;
}
