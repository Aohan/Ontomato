import type { RunMeta } from "@ontomato/contracts/autotest";
import type {
  WorkspaceManifest as RemoteWorkspaceManifest,
  ArtifactRetention,
} from "@ontomato/contracts/observe";
export type ObserveNavGroupKey = "diagnosis" | "observe" | "autotest" | "dsl";

export type ObserveActiveView = "turns" | "live-logs";

export type AutotestActiveView = "run" | "test" | "cases";

// Navigation placeholders have no retention result until their first server response.
export type WorkspaceManifest = RemoteWorkspaceManifest & Partial<ArtifactRetention>;
export type AutotestRunMeta = RunMeta & Partial<ArtifactRetention>;

/** 观察页头部显示的当前账号（企业宿主传入；开源为 null 不显示）。 */
export interface ObserveAccount {
  readonly userName: string;
}

/**
 * DSL 结果区的扩展页签（企业 MQL）：插在数据表与原始响应之间；payload 是原 mqlText 所用的同一次归一结果，
 * activeTab 为当前结果页签。开源不提供。
 */
export interface DslTestPageSlots {
  "result-tabs"?: (props: { payload: any; activeTab: string }) => unknown;
}
