import type { RouteRecordRaw } from "vue-router";

/** View parameters the Manager shell understands; the rest of the query (including credentials) is not passed to the Manager. */
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
 * Shared /admin child route records. Each app lists them explicitly in the original order (its own pages go between the
 * shared ones), with no registration or ordering framework. meta keeps only fields with consumers: group (layout tab
 * lookup), permission (app guards) and category (skill page category); the original title/icon/hidden had no reader.
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
  // Visual modeling now lives in the Manager: the old route enters the Manager entry with the focus/id/back it understands.
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
  // Originally hidden route (no menu item).
  knowledgeGovernance: {
    path: "knowledge-governance/:sessionId?",
    name: "KnowledgeGovernance",
    component: () => import("../features/knowledge-governance/GovernancePage.vue"),
    meta: { group: "app-capabilities", permission: "business-knowledge" },
  },
  // Business knowledge moved into the Ontology Manager sidebar; the old route redirects to the Manager.
  knowledge: {
    path: "knowledge",
    redirect: "/admin/ontology-manager",
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
  // Edition values (BusinessConfigProps) are passed by the app as props on the route record.
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
