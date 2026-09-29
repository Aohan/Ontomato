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
 * 开源网页入口。装配 /chat 工作台布局、/observe 与开源全部管理后台页面（/admin 布局、Manager 入口、知识、热点报告、知识治理、系统监控、
 * 分析智能体、MCP 服务、两类技能、模型配置、系统配置、审计日志、反馈记录与 Manager 旧入口重定向）；
 * 界面已在本机合成接口下完成浏览器验收，真实整栈集成尚未验证，这一构建不能替换现网前端。
 * 菜单顺序：ontology-manager 组（home 直达 iframe，无左侧菜单）；agents-and-skills 组：analysis, skills, mcp-service；
 * system-management 组：model-config, system-config, audit-log, feedback-records, system-monitor。
 */
const adminLayout: AdminLayoutConfig = {
  access: { ready: true, can: () => true },
  groups: [
    adminGroups.dataAssets,
    adminGroups.appCapabilities,
    adminGroups.platformManagement,
  ],
  items: [
    adminMenuItems.analysis,
    adminMenuItems.skills,
    adminMenuItems.mcpService,
    adminMenuItems.modelConfig,
    adminMenuItems.systemConfig,
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
  // 开源的 /observe 无权限门：回合诊断入口对所有用户可见。
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
        adminRoutes.examples,
        adminRoutes.actionManagement,
        adminRoutes.writeTasks,
        adminRoutes.analysis,
        adminRoutes.mcpService,
        adminRoutes.skills,
        adminRoutes.skillsAnalysis,
        adminRoutes.skillsVisualization,
        adminRoutes.modelConfig,
        { ...adminRoutes.businessConfig, props: businessConfig },
        adminRoutes.auditLog,
        adminRoutes.feedbackRecords,
        adminRoutes.systemMonitor,
      ],
    },
    // 开源 /observe 原本没有认证/权限 meta；头部无账号。
    { ...observeRoutes.root, props: { account: null }, children: observeRoutes.children },
  ],
});
