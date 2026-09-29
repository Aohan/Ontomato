import type { RouteRecordRaw } from "vue-router";

/** Manager 外壳认识的视图参数；其余 query（含凭据）不带入 Manager。 */
const MANAGER_VIEW_PARAMS = ["focus", "id", "back"] as const;

export function managerViewQuery(query: Record<string, unknown>): Record<string, string> {
  const picked: Record<string, string> = {};
  for (const key of MANAGER_VIEW_PARAMS) {
    const value = query[key];
    if (typeof value === "string") picked[key] = value;
  }
  return picked;
}

const managerMeta = { group: "data-assets", permission: "ontology-modeling" };

/*
 * 已迁入的 /admin 子路由记录。应用按原顺序显式排列（企业页插在公共页之间），不做注册或排序框架。
 * meta 只保留有消费者的 group（布局页签定位）、permission（企业守卫）与 category（技能页分类）；原 title/icon/hidden 无读取者。
 */
export const adminRoutes = {
  root: { path: "", name: "AdminRoot", redirect: "/admin/ontology-manager" },
  intelligenceAssets: {
    path: "intelligence-assets",
    redirect: "/admin/ontology-manager?view=assets",
    meta: managerMeta,
  },
  ontologyManager: {
    path: "ontology-manager",
    name: "OntologyManager",
    component: () => import("../views/admin/OntologyManagerEntry.vue"),
    meta: managerMeta,
  },
  ontology: {
    path: "ontology",
    name: "Ontology",
    redirect: "/admin/ontology-manager",
    meta: managerMeta,
  },
  // 可视化建模已归并到 Manager：旧路由带着 Manager 认识的 focus/id/back 进入 Manager 入口。
  visualModeling: {
    path: "ontology/visual-modeling",
    name: "VisualModeling",
    redirect: (to) => ({
      path: "/admin/ontology-manager",
      query: { ...managerViewQuery(to.query), view: "visual-modeling" },
    }),
    meta: managerMeta,
  },
  hotData: {
    path: "hot-data",
    redirect: "/admin/analysis?section=reports",
    meta: { group: "app-capabilities", permission: "hot-data" },
  },
  metricViews: {
    path: "metric-views",
    redirect: "/admin/ontology-manager?view=assets",
    meta: { permission: "ontology-modeling" },
  },
  // 原隐藏路由（无菜单项）。
  knowledgeGovernance: {
    path: "knowledge-governance/:sessionId?",
    name: "KnowledgeGovernance",
    component: () => import("../features/knowledge-governance/GovernancePage.vue"),
    meta: { group: "app-capabilities", permission: "business-knowledge" },
  },
  // 业务知识已迁入本体管理器，旧路由重定向到本体管理器的业务知识页。
  knowledge: {
    path: "knowledge",
    redirect: "/admin/ontology-manager?view=knowledge",
    meta: { group: "data-assets", permission: "business-knowledge" },
  },
  examples: {
    path: "examples",
    redirect: "/admin/system-config",
    meta: { group: "platform-management", permission: "query-examples" },
  },
  actionManagement: {
    path: "action-management",
    redirect: "/admin/ontology-manager?view=assets",
    meta: managerMeta,
  },
  writeTasks: {
    path: "write-tasks",
    redirect: "/admin/ontology-manager?view=assets",
    meta: managerMeta,
  },
  analysis: {
    path: "analysis",
    name: "Analysis",
    component: () => import("../features/admin/components/ApplicationManagement.vue"),
    meta: { group: "app-capabilities", permission: "analysis-agent" },
  },
  mcpService: {
    path: "mcp-service",
    name: "McpService",
    component: () => import("../features/mcp/components/McpManager.vue"),
    meta: { group: "app-capabilities", permission: "mcp-service" },
  },
  skills: {
    path: "skills",
    name: "SkillLibrary",
    component: () => import("../features/skills/components/SkillLibrary.vue"),
    meta: { group: "app-capabilities", permission: "skill-management" },
  },
  skillsAnalysis: {
    path: "skills/analysis",
    redirect: "/admin/skills?tab=analysis",
    meta: { group: "app-capabilities", category: "analysis", permission: "analytical-skills" },
  },
  skillsVisualization: {
    path: "skills/visualization",
    redirect: "/admin/skills?tab=visualization",
    meta: { group: "app-capabilities", category: "visualization", permission: "visualization-skills" },
  },
  modelConfig: {
    path: "model-config",
    name: "ModelConfig",
    component: () => import("../features/system/components/ModelConfig.vue"),
    meta: { group: "platform-management", permission: "system-config" },
  },
  // 版本原值（BusinessConfigProps）由应用在路由记录上以 props 传入。
  businessConfig: {
    path: "system-config",
    name: "SystemConfig",
    component: () => import("../features/system/components/BusinessConfig.vue"),
    meta: { group: "platform-management", permission: "system-config" },
  },
  auditLog: {
    path: "audit-log",
    name: "AuditLog",
    component: () => import("../features/admin/components/platform-operations/AuditLogManager.vue"),
    meta: { group: "platform-management", permission: "audit-logs" },
  },
  feedbackRecords: {
    path: "feedback-records",
    name: "FeedbackRecords",
    component: () => import("../features/admin/components/platform-operations/FeedbackRecords.vue"),
    meta: { group: "platform-management", permission: "audit-logs" },
  },
  systemMonitor: {
    path: "system-monitor",
    name: "SystemMonitor",
    component: () => import("../features/admin/components/platform-operations/SystemMonitor.vue"),
    meta: { group: "platform-management", permission: "system-monitoring" },
  },
} satisfies Record<string, RouteRecordRaw>;
