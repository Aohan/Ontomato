import type { KnowledgeManagerProps } from "@ontomato/workbench-ui";
import { workbenchContent } from "./workbench-content";

/** 本版业务知识列表的原值（迁出前开源 KnowledgeManager.vue / useCrudAdmin.ts），经 /admin/knowledge 路由 props 传入。 */
export const knowledgeManager: KnowledgeManagerProps = {
  normalizeResponse: (res) => {
    const data = res?.data ?? res;
    if (Array.isArray(data)) return data;
    return data && typeof data === "object" ? Object.values(data) : [];
  },
  tagValues: { general: "General", business: "Business", tech: "Tech" },
  showEmptyState: true,
  batchDeleteFailureSuffix: workbenchContent.text.batchDeleteFailureSuffix,
};
