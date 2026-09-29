import type { RouteRecordRaw } from "vue-router";

const placeholder = () => import("../views/observe/ObservePlaceholder.vue");

/*
 * The /observe root and its 11 child routes (1 redirect, 10 leaves). Each app assembles its own root: an app may add
 * auth/permission meta and its own shell; the open-source root has no meta. meta keeps only group, which has consumers
 * (ObserveLayout and session-context); the original title had no reader. The observability, auto-test and DSL groups are
 * rendered inline by ObserveLayout; routes only carry group identification and direct URLs (neutral placeholder components).
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
