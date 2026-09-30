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

/** Current account shown in the observe page header (passed by the host; null in open source, so nothing is shown). */
export interface ObserveAccount {
  readonly userName: string;
}

/**
 * Extra tabs of the DSL result area (e.g. MQL), inserted between the data table and the raw response; payload is the same
 * normalized result the original mqlText used and activeTab is the current result tab. Not provided in open source.
 */
export interface DslTestPageSlots {
  "result-tabs"?: (props: { payload: any; activeTab: string }) => unknown;
}
