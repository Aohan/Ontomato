import { tApp } from "../../../i18n";
import type {
  ThinkingBranchStatus,
  QueryThinkingState,
} from "@ontomato/contracts/query-thinking";

export function buildThinkingSummary(state: QueryThinkingState): string {
  const lines: string[] = [];

  if (state.headline) {
    lines.push(`🧭 ${state.headline}`);
  }

  for (const branch of state.branches) {
    if (branch.status === "idle") continue;

    const icon = branchStatusIcon(branch.status);
    const branchLine = `${icon} ${branch.label}${branch.detail ? tApp("queryFixed.271", { v0: (branch.detail) }) : ""}`;
    lines.push(branchLine);

    for (const log of branch.logs.slice(-2)) {
      lines.push(`  · ${log}`);
    }
  }

  if (state.abc?.steps?.length) {
    lines.push("");
    lines.push(tApp("queryFixed.272"));
    for (const step of state.abc.steps) {
      const icon =
        step.status === "done"
          ? "✅"
          : step.status === "running"
            ? "🔄"
            : step.status === "failed"
              ? "❌"
              : "○";
      lines.push(`${icon} ${step.label}${step.detail ? ` ${step.detail}` : ""}`.trim());
    }
  }

  if (state.tailLines?.length) {
    lines.push("");
    lines.push(...state.tailLines);
  }

  return lines
    .filter((line, index, arr) => line !== "" || arr[index - 1] !== "")
    .join("\n")
    .trim();
}

/** Expands the thinking summary line by line into completed thinking steps. */
export function buildThinkingSteps(summary: string) {
  const lines = summary
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return undefined;
  const now = Date.now();
  return lines.map((text, index) => ({
    text,
    done: true,
    timestamp: now + index,
  }));
}

function branchStatusIcon(status: ThinkingBranchStatus): string {
  switch (status) {
    case "running":
      return "🔍";
    case "success":
      return "✅";
    case "insufficient":
      return "📋";
    case "not_found":
      return "📋";
    case "failed":
      return "❌";
    case "cancelled":
      return "⛔";
    default:
      return "⏳";
  }
}
