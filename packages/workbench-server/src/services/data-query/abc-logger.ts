import type {
  ThinkingStep,
  ThinkingProgress as ProgressInfo,
  ThinkingAbcState as AbcThinkingSnapshot,
  ThinkingAbcStep as AbcThinkingStep,
} from "@ontomato/contracts/query-thinking";
import { t } from "../../i18n";

export type AbcStage =
  | "idle"
  | "split"
  | "abc_analysis"
  | "data"
  | "conclusion"
  | "success"
  | "failed"
  | "cancelled";

export type AbcState = {
  stage: AbcStage;
  detail?: string;
};

type PushLog = (patch: { thinking: string; mode: "append" | "replace" }) => void;
type PushProgress = (progress: ProgressInfo) => void;

function getStageLabel(stage: AbcStage): string {
  const keyMap: Record<AbcStage, string> = {
    idle: "abc.idle",
    split: "abc.split",
    abc_analysis: "abc.abcAnalysis",
    data: "abc.data",
    conclusion: "abc.conclusion",
    success: "abc.success",
    failed: "abc.failed",
    cancelled: "abc.cancelled",
  };
  return t(keyMap[stage]) || stage;
}

export function createAbcLogger(opts: {
  pushLog: PushLog;
  pushProgress?: PushProgress;
  maxLogs?: number;
}) {
  const { pushLog, pushProgress, maxLogs = 12 } = opts;

  const logs: ThinkingStep[] = [];
  let state: AbcState = { stage: "idle" };
  let progress: ProgressInfo | null = null;
  let lastThinkingFull = "";
  let currentStageLogIndex = -1;

  function pushUnique(arr: ThinkingStep[], entry: ThinkingStep) {
    const text = entry.text.trim();
    if (!text) return;

    const lastEntry = arr[arr.length - 1];
    if (lastEntry && lastEntry.text === text && !lastEntry.done) {
      return;
    }

    arr.push({ ...entry, text });
    if (arr.length > maxLogs) arr.splice(0, arr.length - maxLogs);
  }

  function markCurrentDone() {
    if (currentStageLogIndex >= 0 && currentStageLogIndex < logs.length) {
      logs[currentStageLogIndex].done = true;
    }
  }

  function flushThinking(force = false) {
    const lines: string[] = [];

    const detail = (state.detail || "").trim();

    if (logs.length > 0) {
      for (const entry of logs) {
        lines.push(entry.text);
      }

      if (
        state.stage !== "success" &&
        state.stage !== "failed" &&
        state.stage !== "cancelled" &&
        detail
      ) {
        lines.push(`${detail}...`);
      }
    } else if (detail) {
      lines.push(detail);
    }

    const full = lines.join("\n");
    if (!force && full === lastThinkingFull) return;
    lastThinkingFull = full;
    pushLog({ thinking: full, mode: "replace" });
  }

  function getSteps(): ThinkingStep[] {
    const detail = (state.detail || "").trim();
    const steps: ThinkingStep[] = [...logs];

    if (
      state.stage !== "success" &&
      state.stage !== "failed" &&
      state.stage !== "cancelled" &&
      detail
    ) {
      steps.push({ text: detail, done: false, timestamp: Date.now() });
    }

    return steps;
  }

  function getSnapshot(): AbcThinkingSnapshot {
    const stageOrder: AbcStage[] = ["split", "abc_analysis", "data", "conclusion"];
    const stageIndex = stageOrder.indexOf(state.stage);

    const steps: AbcThinkingStep[] = stageOrder.map((stage, index) => {
      const label = getStageLabel(stage);
      const isDone = state.stage === "success" || index < stageIndex;
      const isActive = state.stage === stage;
      const isFailed = state.stage === "failed" && index === Math.max(stageIndex, 0);
      const isCancel = state.stage === "cancelled" && index === Math.max(stageIndex, 0);
      const status: AbcThinkingStep["status"] = isFailed
        ? "failed"
        : isCancel
          ? "cancelled"
          : isDone
            ? "done"
            : isActive
              ? "running"
              : "waiting";
      return {
        key: stage,
        label,
        text: label,
        done: isDone,
        timestamp: Date.now() + index,
        active: isActive,
        detail: isActive ? state.detail : undefined,
        status,
      };
    });

    if (state.stage === "failed") {
      steps.push({
        key: "failed",
        label: getStageLabel("failed"),
        text: t("abc.exception", { msg: state.detail || getStageLabel("failed") }),
        done: false,
        timestamp: Date.now() + steps.length,
        active: true,
        detail: state.detail,
        status: "failed",
      });
    }

    return {
      status:
        state.stage === "success"
          ? "success"
          : state.stage === "failed"
            ? "failed"
            : state.stage === "cancelled"
              ? "cancelled"
              : state.stage === "idle"
                ? "idle"
                : "running",
      steps,
      progress,
    };
  }

  function setProgress(current: number, total: number, label?: string) {
    progress = { current, total, label };
    if (pushProgress) {
      pushProgress({ current, total, label });
    }
    flushThinking();
  }

  return {
    getState: () => state,

    getProgress: () => progress,

    getSnapshot() {
      return getSnapshot();
    },

    setProgress(current: number, total: number, label?: string) {
      setProgress(current, total, label);
    },

    setStage(stage: AbcStage, detail?: string) {
      markCurrentDone();

      state = { stage, detail: detail?.trim() };

      const stageMessage = getStageLabel(stage);
      if (stageMessage) {
        pushUnique(logs, { text: stageMessage, done: false, timestamp: Date.now() });
        currentStageLogIndex = logs.length - 1;
      }

      flushThinking();
    },

    log(s: string) {
      pushUnique(logs, { text: s, done: true, timestamp: Date.now() });
      flushThinking();
    },

    success(message?: string) {
      markCurrentDone();

      state = { stage: "success", detail: message };

      if (message) {
        pushUnique(logs, { text: message, done: true, timestamp: Date.now() });
      }

      for (let i = 0; i < logs.length; i++) {
        logs[i].done = true;
      }

      flushThinking(true);
    },

    failed(message: string) {
      markCurrentDone();

      state = { stage: "failed", detail: message };
      pushUnique(logs, {
        text: t("abc.exception", { msg: message }),
        done: false,
        timestamp: Date.now(),
      });
      flushThinking(true);
    },

    cancelled(message?: string) {
      markCurrentDone();

      state = { stage: "cancelled", detail: message?.trim() };
      const logText = message ? t("abc.cancelledWithMsg", { msg: message }) : t("abc.cancelled");
      pushUnique(logs, { text: logText, done: false, timestamp: Date.now() });
      flushThinking(true);
    },

    flush(force = false) {
      flushThinking(force);
    },

    getSteps() {
      return getSteps();
    },
  };
}

export type AbcLogger = ReturnType<typeof createAbcLogger>;

export function formatSubQuestionLog(sq: string, index: number): string {
  const sqText = (sq || "").trim().slice(0, 50);
  return t("abc.subQuestion", { n: index + 1, text: sqText + (sq.length > 50 ? "…" : "") });
}

export function formatDataLog(count: number, total?: number): string {
  if (total !== undefined) {
    return t("abc.dataLogReceivedTotal", { n: count, total });
  }
  return t("abc.dataLogReceived", { n: count });
}
