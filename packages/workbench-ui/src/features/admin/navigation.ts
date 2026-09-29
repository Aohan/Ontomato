import type { Component } from "vue";
import {
  Activity,
  Blocks,
  Cpu,
  Database,
  MessageSquare,
  Monitor,
  Network,
  Puzzle,
  ScrollText,
  ServerCog,
} from "lucide-vue-next";

/** Top tabs of the admin console. permission is a public capability id: apps with permissions filter by it; open source runs no permission logic. */
export interface AdminGroup {
  key: string;
  titleKey: string;
  permission: string;
  icon: Component;
  /** Default landing path when the tab is selected (e.g. the Ontology Manager shows its iframe directly without a sidebar menu item). */
  homePath?: string;
}

export interface AdminMenuItem {
  permission: string;
  path: string;
  titleKey: string;
  icon: Component;
  groupKey: string;
}

/** Tabs that only run an action and have no menu items (e.g. a "data governance" jump). Placed before the grouped tabs. */
export interface AdminActionTab {
  key: string;
  titleKey: string;
  icon: Component;
  select(): void;
}

/** The app's access check: ready means permissions are loaded; open source is always ready and always allowed. */
export interface AdminAccess {
  readonly ready: boolean;
  can(permission: string): boolean;
}

/** Header display and logout for the signed-in account; open source has no account. */
export interface AdminAccount {
  readonly userName: string;
  logout(): void;
}

/**
 * Assembly input of the admin layout. navigationHidden is the reduced layout used when licensing is restricted:
 * only back, title, theme and account remain; tabs, sidebar and loading/no-permission states are hidden.
 */
export interface AdminLayoutConfig {
  access: AdminAccess;
  groups: readonly AdminGroup[];
  items: readonly AdminMenuItem[];
  actionTabs: readonly AdminActionTab[];
  account: AdminAccount | null;
  navigationHidden: boolean;
}

/** Shared tabs and menu items; each app lists the ones it uses explicitly in the original order. */
export const adminGroups = {
  dataAssets: {
    key: "data-assets",
    titleKey: "nav.ontologyManager",
    permission: "intelligence-engine",
    icon: Database,
    homePath: "/admin/ontology-manager",
  },
  appCapabilities: {
    key: "app-capabilities",
    titleKey: "nav.agentsAndSkills",
    permission: "application-management",
    icon: Blocks,
  },
  platformManagement: {
    key: "platform-management",
    titleKey: "nav.systemManagement",
    permission: "system-management",
    icon: Monitor,
  },
} satisfies Record<string, AdminGroup>;

export const adminMenuItems = {
  analysis: {
    permission: "analysis-agent",
    path: "/admin/analysis",
    titleKey: "nav.analysisAgents",
    icon: Blocks,
    groupKey: "app-capabilities",
  },
  mcpService: {
    permission: "mcp-service",
    path: "/admin/mcp-service",
    titleKey: "nav.mcpService",
    icon: Network,
    groupKey: "app-capabilities",
  },
  skills: {
    permission: "skill-management",
    path: "/admin/skills",
    titleKey: "nav.skills",
    icon: Puzzle,
    groupKey: "app-capabilities",
  },
  modelConfig: {
    permission: "system-config",
    path: "/admin/model-config",
    titleKey: "nav.modelConfig",
    icon: Cpu,
    groupKey: "platform-management",
  },
  systemConfig: {
    permission: "system-config",
    path: "/admin/system-config",
    titleKey: "nav.systemConfig",
    icon: ServerCog,
    groupKey: "platform-management",
  },
  auditLog: {
    permission: "audit-logs",
    path: "/admin/audit-log",
    titleKey: "nav.auditLogs",
    icon: ScrollText,
    groupKey: "platform-management",
  },
  feedbackRecords: {
    permission: "audit-logs",
    path: "/admin/feedback-records",
    titleKey: "nav.feedbackRecords",
    icon: MessageSquare,
    groupKey: "platform-management",
  },
  systemMonitor: {
    permission: "system-monitoring",
    path: "/admin/system-monitor",
    titleKey: "nav.systemMonitoring",
    icon: Activity,
    groupKey: "platform-management",
  },
} satisfies Record<string, AdminMenuItem>;
