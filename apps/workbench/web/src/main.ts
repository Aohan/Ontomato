import "element-plus/dist/index.css";
import "element-plus/theme-chalk/dark/css-vars.css";
import "./theme.css";
import "@ontomato/workbench-ui/styles/style.css";
import "./narrow-dialogs.css";
import "@ontomato/workbench-ui/styles/admin-common.css";
import en from "element-plus/es/locale/lang/en";
import publicEn from "@ontomato/workbench-ui/locales/en";
import {
  adminGroups,
  AdminLayout,
  adminMenuItems,
  adminRoutes,
  observeRoutes,
  startWorkbenchWeb,
  type AdminLayoutConfig,
} from "@ontomato/workbench-ui";
import { anonymousAuthHost } from "./auth";
import { businessConfig } from "./business-config";
import { workbenchContent } from "./workbench-content";

/*
 * Open-source web entry. Assembles the /chat workbench layout, /observe and all open-source admin pages (the /admin
 * layout, the Manager entry (business knowledge lives in the Manager), business agents, analysis plans, system agents,
 * knowledge governance, skills, MCP services, model configuration, system config, query examples, audit log, feedback
 * records and system monitor, plus redirects for business knowledge, hot reports and the old Manager entry). The UI has
 * passed browser acceptance against locally synthesized APIs; real full-stack integration is not yet verified, so this
 * build cannot replace the production frontend.
 * Menu: the Ontology Manager tab (home-style, opens the Manager directly, no sidebar menu); Agents and Skills: analysis,
 * analysis-plans, system-agents, skills, mcp-service; System Management: model-config, system-config, examples,
 * audit-log, feedback-records, system-monitor.
 */
const adminLayout: AdminLayoutConfig = {
  access: { ready: true, can: () => true },
  groups: [
    adminGroups.dataAssets,
    adminGroups.appCapabilities,
    adminGroups.platformManagement,
  ],
  items: [
    adminMenuItems.businessAgents,
    adminMenuItems.analysisPlans,
    adminMenuItems.systemAgents,
    adminMenuItems.skills,
    adminMenuItems.mcpService,
    adminMenuItems.modelConfig,
    adminMenuItems.systemConfig,
    adminMenuItems.queryExamples,
    adminMenuItems.auditLog,
    adminMenuItems.feedbackRecords,
    adminMenuItems.systemMonitor,
  ],
  actionTabs: [],
  account: null,
  navigationHidden: false,
};

startWorkbenchWeb({
  language: {
    supported: ["en"],
    defaultLocale: "en",
    initialLocale: "en",
    switchEnabled: false,
    save: null,
    messages: { en: publicEn },
    elementLocale: () => en,
  },
  auth: anonymousAuthHost,
  errorPunctuation: { detailSeparator: ":", listSeparator: ";" },
  ontologyManagerEntry: {
    themeMessage: "ontomato-theme",
    localeMessage: null,
    frameTitle: "Ontology Manager",
    missingUrlTitle: "Ontology manager address not configured",
    missingUrlDescription: "Please set ONTOLOGY_MANAGER_URL in the Ontomato service and redeploy.",
  },
  content: workbenchContent,
  // The open-source /observe has no permission gate: the turn diagnosis entry is visible to all users.
  turnDiagnosis: { prepare: () => {}, visible: () => true },
  routes: [
    { path: "/", redirect: "/chat" },
    { path: "/chat", name: "Chat", component: () => import("./layout/UnifiedLayout.vue") },
    { path: "/analysis", name: "AnalysisMode", redirect: "/chat" },
    {
      path: "/admin",
      component: AdminLayout,
      props: adminLayout,
      children: [
        adminRoutes.root,
        adminRoutes.intelligenceAssets,
        adminRoutes.ontologyManager,
        adminRoutes.ontology,
        adminRoutes.visualModeling,
        adminRoutes.hotData,
        adminRoutes.metricViews,
        adminRoutes.knowledgeGovernance,
        adminRoutes.knowledge,
        adminRoutes.actionManagement,
        adminRoutes.writeTasks,
        adminRoutes.analysis,
        adminRoutes.analysisPlans,
        adminRoutes.systemAgents,
        adminRoutes.mcpService,
        adminRoutes.skills,
        adminRoutes.skillsAnalysis,
        adminRoutes.skillsVisualization,
        adminRoutes.modelConfig,
        { ...adminRoutes.businessConfig, props: businessConfig },
        adminRoutes.examples,
        adminRoutes.auditLog,
        adminRoutes.feedbackRecords,
        adminRoutes.systemMonitor,
      ],
    },
    // The open-source /observe had no auth/permission meta; the header has no account.
    { ...observeRoutes.root, props: { account: null }, children: observeRoutes.children },
  ],
});
