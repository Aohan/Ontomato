import { t } from "../../../i18n";

const EXECUTION_STATUS_LABEL_KEYS: Record<string, string> = {
  success: "autotest.execSuccess",
  completed: "task.completed",
  running: "task.executing",
  queued: "task.pending",
  stopping: "diagnosis.stopping",
  cancelled: "common.cancelled",
  failed: "autotest.execFailed",
  error: "autotest.execError",
};

export function getExecutionStatusTagType(status?: string): "success" | "danger" | "warning" {
  if (status === "success" || status === "completed") return "success";
  if (status === "failed") return "danger";
  return "warning";
}

export function getExecutionStatusLabel(status?: string): string {
  const labelKey = status ? EXECUTION_STATUS_LABEL_KEYS[status] : undefined;
  return labelKey ? t(labelKey) : status || "-";
}

export function formatDuration(ms?: number): string {
  if (ms == null) return "-";
  return `${(ms / 1000).toFixed(1)}s`;
}
