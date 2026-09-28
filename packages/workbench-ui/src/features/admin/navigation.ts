import type { Component } from "vue";
import {
  Blocks,
  Database,
  Monitor,
  Network,
  Orbit,
  Puzzle,
  ScrollText,
  ServerCog,
} from "lucide-vue-next";

/** 管理后台顶部页签。permission 是公开的能力标识：企业权限据此过滤，开源不执行权限算法。 */
export interface AdminGroup {
  key: string;
  titleKey: string;
  permission: string;
  icon: Component;
}

export interface AdminMenuItem {
  permission: string;
  path: string;
  titleKey: string;
  icon: Component;
  groupKey: string;
}

/** 只执行动作、不含菜单项的页签（企业“数据治理”跳转）。排在分组页签之前。 */
export interface AdminActionTab {
  key: string;
  titleKey: string;
  icon: Component;
  select(): void;
}

/** 应用的访问判定：ready 为权限已加载；开源恒就绪、恒可访问。 */
export interface AdminAccess {
  readonly ready: boolean;
  can(permission: string): boolean;
}

/** 已登录账号的头部显示与退出（企业）；开源无账号。 */
export interface AdminAccount {
  readonly userName: string;
  logout(): void;
}

/**
 * 管理布局的装配输入。navigationHidden 为企业授权受限时的精简布局：
 * 只保留返回、标题、主题与账号，不显示页签、侧栏与加载/无权限状态。
 */
export interface AdminLayoutConfig {
  access: AdminAccess;
  groups: readonly AdminGroup[];
  items: readonly AdminMenuItem[];
  actionTabs: readonly AdminActionTab[];
  account: AdminAccount | null;
  navigationHidden: boolean;
}

/** 已迁入的公共页签与菜单项；应用按原顺序显式列出所用的项。 */
export const adminGroups = {
  dataAssets: {
    key: "data-assets",
    titleKey: "nav.dataAssets",
    permission: "intelligence-engine",
    icon: Database,
  },
  appCapabilities: {
    key: "app-capabilities",
    titleKey: "nav.appAndCapabilities",
    permission: "application-management",
    icon: Blocks,
  },
  platformManagement: {
    key: "platform-management",
    titleKey: "nav.platformManagement",
    permission: "system-management",
    icon: Monitor,
  },
} satisfies Record<string, AdminGroup>;

export const adminMenuItems = {
  ontologyManager: {
    permission: "ontology-modeling",
    path: "/admin/ontology-manager",
    titleKey: "nav.ontologyAssets",
    icon: Orbit,
    groupKey: "data-assets",
  },
  analysis: {
    permission: "analysis-agent",
    path: "/admin/analysis",
    titleKey: "nav.analysisApplications",
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
    titleKey: "nav.skillAndKnowledge",
    icon: Puzzle,
    groupKey: "app-capabilities",
  },
  businessConfig: {
    permission: "system-config",
    path: "/admin/system-config",
    titleKey: "nav.systemConfig",
    icon: ServerCog,
    groupKey: "platform-management",
  },
  operations: {
    permission: "system-management",
    path: "/admin/operations",
    titleKey: "nav.operationsCenter",
    icon: ScrollText,
    groupKey: "platform-management",
  },
} satisfies Record<string, AdminMenuItem>;
