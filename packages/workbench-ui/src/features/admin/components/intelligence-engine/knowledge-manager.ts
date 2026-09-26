/** 业务知识实体（原 KnowledgeManager.vue 内的接口，移出不改）。 */
export interface Knowledge {
  knowledgeID: string;
  knowledgeTitle: string;
  knowledgeText: string;
  knowledgeTags: string[];
  creatorType: number;
  status: number;
}

/** 业务知识列表的本版原值：两个应用在各自路由记录上以 props 传入。 */
export interface KnowledgeManagerProps {
  /** 列表响应归一化：两版各自的原表达式（对缺 data、非对象等异常输入的处理原本不同）。 */
  normalizeResponse: (res: any) => Knowledge[];
  /** 标签选项的实际提交与落盘值；选项显示仍走 knowledge.general/business/tech 词条。 */
  tagValues: { general: string; business: string; tech: string };
  /** 未加载且无数据时隐藏表格/卡片并显示空态（开源原有；企业原仍显示空的表格或卡片容器）。 */
  showEmptyState: boolean;
  /** 批量删除部分失败提示末尾的计数原文。 */
  batchDeleteFailureSuffix: (failed: number, total: number) => string;
}
