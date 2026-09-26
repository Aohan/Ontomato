import type { Component } from "vue";
import {
  BarChart3,
  Blocks,
  BookOpen,
  Bot,
  Brain,
  Cpu,
  Flame,
  List,
  MessageSquareText,
  Monitor,
  Network,
  Orbit,
  PieChart,
  Puzzle,
  ScrollText,
  Settings,
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
  dataEngine: {
    key: "data-engine",
    titleKey: "nav.dataEngine",
    permission: "intelligence-engine",
    icon: Cpu,
  },
  intelligenceEngine: {
    key: "intelligence-engine",
    titleKey: "nav.intelligenceEngine",
    permission: "smart-engine",
    icon: Brain,
  },
  application: {
    key: "application",
    titleKey: "nav.appManagement",
    permission: "application-management",
    icon: Blocks,
  },
  skills: {
    key: "skills",
    titleKey: "nav.skillManagement",
    permission: "skill-management",
    icon: Puzzle,
  },
  platformGovernance: {
    key: "platform-governance",
    titleKey: "nav.systemManagement",
    permission: "system-management",
    icon: Monitor,
  },
} satisfies Record<string, AdminGroup>;

export const adminMenuItems = {
  ontologyManager: {
    permission: "ontology-modeling",
    path: "/admin/ontology-manager",
    titleKey: "nav.ontologyManager",
    icon: Orbit,
    groupKey: "data-engine",
  },
  hotData: {
    permission: "hot-data",
    path: "/admin/hot-data",
    titleKey: "nav.hotReportManagement",
    icon: Flame,
    groupKey: "intelligence-engine",
  },
  knowledge: {
    permission: "business-knowledge",
    path: "/admin/knowledge",
    titleKey: "nav.businessKnowledge",
    icon: BookOpen,
    groupKey: "intelligence-engine",
  },
  examples: {
    permission: "query-examples",
    path: "/admin/examples",
    titleKey: "nav.queryExamples",
    icon: List,
    groupKey: "intelligence-engine",
  },
  analysis: {
    permission: "analysis-agent",
    path: "/admin/analysis",
    titleKey: "analysis.agent",
    icon: Bot,
    groupKey: "application",
  },
  mcpService: {
    permission: "mcp-service",
    path: "/admin/mcp-service",
    titleKey: "nav.mcpService",
    icon: Network,
    groupKey: "application",
  },
  analysisSkills: {
    permission: "analytical-skills",
    path: "/admin/skills/analysis",
    titleKey: "admin.analysisSkills",
    icon: BarChart3,
    groupKey: "skills",
  },
  visualizationSkills: {
    permission: "visualization-skills",
    path: "/admin/skills/visualization",
    titleKey: "admin.visualizationSkills",
    icon: PieChart,
    groupKey: "skills",
  },
  businessConfig: {
    permission: "system-config",
    path: "/admin/system-config",
    titleKey: "nav.systemConfig",
    icon: Settings,
    groupKey: "platform-governance",
  },
  auditLog: {
    permission: "audit-logs",
    path: "/admin/audit-log",
    titleKey: "nav.auditLogs",
    icon: ScrollText,
    groupKey: "platform-governance",
  },
  feedbackRecords: {
    permission: "audit-logs",
    path: "/admin/feedback-records",
    titleKey: "nav.feedbackRecords",
    icon: MessageSquareText,
    groupKey: "platform-governance",
  },
  systemMonitor: {
    permission: "system-monitoring",
    path: "/admin/system-monitor",
    titleKey: "nav.systemMonitoring",
    icon: Monitor,
    groupKey: "platform-governance",
  },
} satisfies Record<string, AdminMenuItem>;
