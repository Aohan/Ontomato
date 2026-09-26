import type { RouteRecordRaw } from "vue-router";

const placeholder = () => import("../views/observe/ObservePlaceholder.vue");

/*
 * /observe 根与 11 个子路由（1 个重定向、10 个叶）。应用各自组装根：企业根带原 requiresAuth/requiresPermission/observer
 * 并换成私有外壳；开源根没有 meta。meta 只保留有消费者的 group（ObserveLayout 与 session-context 读取）；原 title 无读取者。
 * 可观测性、自动测试与 DSL 分组由 ObserveLayout 内联渲染，路由只承载分组识别与直达 URL（中性占位组件）。
 */
export const observeRoutes = {
  root: {
    path: "/observe",
    component: () => import("../features/diagnosis/components/layout/ObserveLayout.vue"),
  },
  children: [
    { path: "", redirect: "/observe/diagnosis" },
    {
      path: "diagnosis",
      name: "ObserveDiagnosis",
      component: () => import("../features/diagnosis/components/agent-chat/DiagnosisPage.vue"),
      meta: { group: "diagnosis" },
    },
    {
      path: "knowledge",
      name: "ObserveKnowledge",
      component: () => import("../features/diagnosis/components/knowledge/KnowledgePage.vue"),
      meta: { group: "diagnosis" },
    },
    { path: "turn", name: "ObserveTurn", component: placeholder, meta: { group: "observe" } },
    { path: "turn/:turnKey", name: "ObserveTurnDetail", component: placeholder, meta: { group: "observe" } },
    { path: "live-logs", name: "ObserveLiveLogs", component: placeholder, meta: { group: "observe" } },
    { path: "test", name: "ObserveTest", component: placeholder, meta: { group: "autotest" } },
    { path: "results", name: "ObserveResults", component: placeholder, meta: { group: "autotest" } },
    { path: "cases", name: "ObserveCases", component: placeholder, meta: { group: "autotest" } },
    {
      path: "autotest/runs/:runId/cases/:caseId",
      name: "ObserveAutoTestCaseDetail",
      component: () => import("../features/diagnosis/components/results/CaseArtifactPage.vue"),
      meta: { group: "autotest" },
    },
    { path: "dsl", name: "ObserveDsl", component: placeholder, meta: { group: "dsl" } },
  ] satisfies RouteRecordRaw[],
};
