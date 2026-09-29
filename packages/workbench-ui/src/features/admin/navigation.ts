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

/** 管理后台顶部页签。permission 是公开的能力标识：企业权限据此过滤，开源不执行权限算法。 */
export interface AdminGroup {
  key: string;
  titleKey: string;
  permission: string;
  icon: Component;
  /** 选中页签时的默认落点（例如 Ontology Manager 直接展示 iframe，不占用左侧菜单项）。 */
  homePath?: string;
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
