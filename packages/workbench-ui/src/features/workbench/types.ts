import type { ThreadListItem } from "@ontomato/contracts/chat";
import type { DashboardListItem } from "@ontomato/contracts/dashboard";
export type QAThread = Pick<ThreadListItem, "threadId" | "createdAt" | "messageCount"> &
  Partial<Pick<ThreadListItem, "updatedAt" | "title">>;
export type DashboardSidebarItem = Pick<DashboardListItem, "id" | "name"> &
  Partial<Pick<DashboardListItem, "updatedAt">> & { charts?: number };
import type { AnalysisAgent } from "@ontomato/contracts/analysis-agent";

export type WorkbenchSelectionMode = "qa" | "analysis" | "all";

export type WorkbenchAgent = Omit<AnalysisAgent, "executionMode" | "reportDeliverableEnabled"> & {
  /** Delivery mode determines page rendering: agents with reports disabled use the regular conversation view. */
  reportDeliverableEnabled?: boolean;
  isQA?: boolean;
  _divider?: boolean;
};

export interface TaskProgressState {
  progress?: number;
  stageText: string;
}

/** Robot animation of the welcome state: light/dark videos or a static icon (open source); the app states the type explicitly instead of guessing from the file suffix. */
export type WelcomeAnimation =
  | { kind: "video"; src: string }
  | { kind: "image"; src: string; alt: string };
