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

/** 欢迎态的机器人动画：企业为明暗两版视频，开源为静态图标；类型由应用明确给出，不按后缀猜。 */
export type WelcomeAnimation =
  | { kind: "video"; src: string }
  | { kind: "image"; src: string; alt: string };
