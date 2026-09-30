import { t } from "../../../i18n";
import { v4 as uuidv4 } from "uuid";
import type {
  AnalysisActivity,
  AnalysisEvidenceQuestion,
  AnalysisSection,
  DeepAnalysisTaskPayload,
} from "@ontomato/contracts/analysis-presentation";
import type {
  DeepAnalysisEmittedEvent,
  DeepAnalysisThinkingStateEvent,
} from "@ontomato/contracts/analysis-events";
import type {
  AnalysisChartDiagnostic,
  AnalysisChartResult,
} from "@ontomato/contracts/analysis-charts";
import { createLogger } from "../../../logging/logger";
import { buildDeepAnalysisTaskResult } from "./task-result";
import { getAnalysisTaskService } from "./task-service";
import type { AnalysisRunIdentity } from "./run-history";
import { tApp } from "../../../i18n";


const logger = createLogger("deep-analysis-artifacts");
type ActivityFields = Partial<Omit<AnalysisActivity, "seq" | "revision" | "startedAt" | "status">>;

/** Stage copy is server-side progress; concurrent dimensions advance on global preconditions. */
function getDimensionProgressLabel(
  activities: readonly AnalysisActivity[],
  sections: readonly AnalysisSection[]
): string {
  const plan = activities.find((activity) => activity.kind === "plan");
  if (plan?.status !== "completed") return t("analysis.progress.framework");
  const evidence = activities.filter((activity) => activity.kind === "evidence");
  const questions = new Map(
    evidence.flatMap((activity) =>
      (activity.questions || []).map((q) => [q.questionId, q] as const)
    )
  );
  const settled = (status?: string) => status === "completed" || status === "failed";
  if (
    evidence.some((activity) => !settled(activity.status)) ||
    plan.dimensions?.some((dimension) =>
      dimension.questions.some((q) => !settled(questions.get(q.questionId)?.status))
    )
  )
    return t("analysis.progress.collection");
  if (
    activities.some(
      (activity) =>
        activity.groupId &&
        (activity.kind === "skill" || activity.kind === "chart") &&
        !settled(activity.status)
    ) ||
    (!sections.length && !activities.some((activity) => activity.kind === "chapter"))
  )
    return t("analysis.progress.analysis");
  return t("analysis.progress.report");
}

function mergeQuestions(
  current: AnalysisEvidenceQuestion[] = [],
  updates: AnalysisEvidenceQuestion[]
): AnalysisEvidenceQuestion[] {
  const questions = new Map(current.map((question) => [question.questionId, question]));
  for (const update of updates) {
    const previous = questions.get(update.questionId);
    if (
      previous &&
      previous.status !== "running" &&
      previous.status !== "pending" &&
      (update.status === "running" || update.status === "pending")
    )
      continue;
    questions.set(update.questionId, {
      ...previous,
      ...update,
      ...(previous?.execution || update.execution
        ? { execution: { ...previous?.execution, ...update.execution } }
        : {}),
    });
  }
  return [...questions.values()];
}

/** One accumulator for both forms: whole-activity updates, section deltas, and scoped charts each have exactly one event channel. */
export function createDeepAnalysisArtifactStore(target: {
  taskId?: string;
  /** Run identity captured at acceptance; artifacts and terminal states use it to confirm the current task is still writable. */
  identity?: AnalysisRunIdentity;
  requestSeq?: number;
  executionMode: DeepAnalysisTaskPayload["executionMode"];
  emit?: (event: DeepAnalysisEmittedEvent) => void;
  initialPayload?: DeepAnalysisTaskPayload;
}) {
  let revision = target.initialPayload?.runState.revision || 0;
  let seq = Math.max(0, ...(target.initialPayload?.activities.map((a) => a.seq) || []));
  let payload: DeepAnalysisTaskPayload = target.initialPayload || {
    executionMode: target.executionMode,
    runState: {
      status: "running",
      revision: 0,
      progress: {
        done: 0,
        ...(target.executionMode === "dimension" ? { total: 100 } : {}),
        label: target.executionMode === "dimension" ? getDimensionProgressLabel([], []) : "",
      },
    },
    activities: [],
    sections: [],
    charts: [],
    chartDiagnostics: [],
  };
  let writes = Promise.resolve();
  const emit = (event: DeepAnalysisEmittedEvent) => target.emit?.(event);
  const persist = () => {
    if (!target.taskId) return Promise.resolve();
    const snapshot = payload;
    const write = writes.then(async () => {
      await getAnalysisTaskService().updateTaskArtifacts(
        target.taskId!,
        {
          analysisPayload: snapshot,
          requestSeq: target.requestSeq,
          resultSummary:
            snapshot.runState.status === "failed"
              ? tApp("analysis.task.artifacts.404", { value: snapshot.runState.error || "" })
              : snapshot.runState.status === "cancelled"
                ? snapshot.runState.error
                : buildDeepAnalysisTaskResult(snapshot).resultSummary,
        },
        target.identity
      );
    });
    writes = write.catch((error) =>
      logger.error(tApp("analysis.task.artifacts.405"), { taskId: target.taskId, error })
    );
    return write;
  };
  const progress = () => {
    const previous = payload.runState;
    const active = [...payload.activities]
      .reverse()
      .find((activity) => activity.status === "running");
    let label =
      active?.narrative ||
      active?.topic ||
      active?.chapter ||
      active?.questions?.find((q) => q.status === "running")?.question ||
      active?.skills?.[0]?.skillId ||
      (active ? t(`analysis.activity.${active.kind}`) : "");
    let done = payload.activities.filter((activity) => activity.status !== "running").length;
    if (target.executionMode === "dimension") {
      label = getDimensionProgressLabel(payload.activities, payload.sections);
      const plan = payload.activities.find(
        (activity) => activity.kind === "plan" && activity.status === "completed"
      );
      const questions = payload.activities.flatMap((activity) => activity.questions || []);
      const settled = questions.filter(
        (q) => q.status !== "running" && q.status !== "pending"
      ).length;
      const dimensions = plan?.dimensions || [];
      const reports = dimensions.filter((dimension) =>
        payload.sections.some((s) => s.sectionId === dimension.dimensionId && s.status)
      ).length;
      done = plan
        ? 12 +
          (questions.length ? Math.round((58 * settled) / questions.length) : 0) +
          (dimensions.length ? Math.round((27 * reports) / dimensions.length) : 0)
        : 0;
      if (previous.status !== "running") done = 100;
    }
    payload = {
      ...payload,
      runState: {
        ...previous,
        revision: ++revision,
        progress: {
          ...previous.progress,
          done: Math.max(previous.progress.done, Math.round(done)),
          label,
        },
      },
    };
  };
  const emitState = () =>
    emit({
      type: "analysis_run_state",
      executionMode: target.executionMode,
      content: payload.runState,
      timestamp: Date.now(),
    });
  const publish = (activity: AnalysisActivity) => {
    if (activity.questions) {
      const previous = payload.activities.find((a) => a.activityId === activity.activityId);
      activity = {
        ...activity,
        questions: mergeQuestions(previous?.questions, activity.questions),
      };
    }
    payload = {
      ...payload,
      activities: [
        ...payload.activities.filter((a) => a.activityId !== activity.activityId),
        activity,
      ].sort((a, b) => a.seq - b.seq),
    };
    progress();
    void persist();
    emit({ type: "analysis_activity", content: activity, timestamp: Date.now() });
    emitState();
  };
  const store = {
    current: () => payload,
    start(kind: AnalysisActivity["kind"], fields: ActivityFields = {}) {
      if (payload.runState.status !== "running") throw new Error(t("analysis.runEnded"));
      const activity: AnalysisActivity = {
        ...fields,
        activityId: fields.activityId || uuidv4(),
        seq: ++seq,
        revision: ++revision,
        kind,
        status: "running",
        startedAt: Date.now(),
      };
      publish(activity);
      return activity.activityId;
    },
    update(activityId: string, fields: ActivityFields) {
      const current = payload.activities.find((a) => a.activityId === activityId);
      if (!current || current.status !== "running") return;
      publish({ ...current, ...fields, activityId, revision: ++revision });
    },
    settle(
      activityId: string,
      status: Exclude<AnalysisActivity["status"], "running">,
      fields: ActivityFields = {}
    ) {
      const current = payload.activities.find((a) => a.activityId === activityId);
      if (!current || current.status !== "running") return;
      publish({
        ...current,
        ...fields,
        activityId,
        status,
        revision: ++revision,
        finishedAt: Date.now(),
      });
    },
    question(activityId: string, questionId: string, fields: Partial<AnalysisEvidenceQuestion>) {
      const activity = payload.activities.find((a) => a.activityId === activityId);
      const question = activity?.questions?.find((q) => q.questionId === questionId);
      if (!question) return;
      store.update(activityId, {
        questions: [{ ...question, ...fields }],
      });
    },
    thinking(content: DeepAnalysisThinkingStateEvent["content"]) {
      if (payload.runState.status !== "running") return;
      payload = {
        ...payload,
        activities: payload.activities.map((activity) =>
          activity.activityId !== content.activityId
            ? activity
            : {
                ...activity,
                questions: activity.questions?.map((q) =>
                  q.questionId !== content.questionId
                    ? q
                    : { ...q, execution: { ...q.execution, thinkingState: content.thinkingState } }
                ),
              }
        ),
      };
      void persist();
      emit({ type: "thinking_state", node: "analysis", content, timestamp: Date.now() });
    },
    section(
      input: Omit<AnalysisSection, "revision" | "order"> & {
        order?: number;
        mode: "append" | "replace";
      }
    ) {
      if (payload.runState.status !== "running") return;
      const previous = payload.sections.find((s) => s.sectionId === input.sectionId);
      const { mode, ...fields } = input;
      const offset = mode === "append" ? previous?.markdown.length || 0 : 0;
      const section: AnalysisSection = {
        ...previous,
        ...fields,
        order: input.order ?? previous?.order ?? payload.sections.length,
        revision: ++revision,
        markdown: mode === "append" ? (previous?.markdown || "") + input.markdown : input.markdown,
      };
      payload = {
        ...payload,
        sections: [
          ...payload.sections.filter((s) => s.sectionId !== section.sectionId),
          section,
        ].sort((a, b) => a.order - b.order),
      };
      progress();
      void persist();
      emit({
        type: "analysis_section",
        content: { ...section, markdown: input.markdown, mode, offset },
        timestamp: Date.now(),
      });
      emitState();
    },
    charts(scopeId: string, charts: AnalysisChartResult[], diagnostics: AnalysisChartDiagnostic[]) {
      if (payload.runState.status !== "running") return;
      payload = {
        ...payload,
        charts: [
          ...new Map(
            [...payload.charts, ...charts].map((chart) => [chart.chartId, chart])
          ).values(),
        ],
        chartDiagnostics: [
          ...new Map(
            [...payload.chartDiagnostics, ...diagnostics].map((diagnostic) => [
              JSON.stringify(diagnostic),
              diagnostic,
            ])
          ).values(),
        ],
      };
      void persist();
      emit({
        type: "analysis_charts",
        content: { scopeId, charts, diagnostics },
        timestamp: Date.now(),
      });
    },
    async finish(
      status: Exclude<AnalysisActivity["status"], "running">,
      error?: string,
      finalAnswer?: string
    ) {
      for (const section of payload.sections) {
        if (!section.status)
          store.section({
            ...section,
            mode: "replace",
            status: section.markdown ? "success" : "failed",
          });
      }
      for (const activity of payload.activities) {
        if (activity.status !== "running") continue;
        const stopped = status === "cancelled" ? "cancelled" : "failed";
        store.settle(activity.activityId, stopped, {
          error,
          questions: activity.questions?.map((q) =>
            q.status === "running" || q.status === "pending" ? { ...q, status: stopped } : q
          ),
          skills: activity.skills?.map((s) =>
            s.status === "running" ? { ...s, status: stopped } : s
          ),
        });
      }
      payload = {
        ...payload,
        ...(finalAnswer !== undefined ? { finalAnswer } : {}),
        runState: { ...payload.runState, status, error },
      };
      progress();
      // The final artifact and the task terminal state are one write; failure must propagate and never publish a successful terminal state.
      await persist();
      emitState();
      return payload;
    },
  };
  return store;
}

export type DeepAnalysisArtifactStore = ReturnType<typeof createDeepAnalysisArtifactStore>;
