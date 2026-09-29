/** Business knowledge entity (the interface originally in KnowledgeManager.vue, moved unchanged). */
export interface Knowledge {
  knowledgeID: string;
  knowledgeTitle: string;
  knowledgeText: string;
  knowledgeTags: string[];
  creatorType: number;
  status: number;
}

/** Edition-specific values of the business knowledge list: each app passes them as props on its route record. */
export interface KnowledgeManagerProps {
  /** List response normalization: each edition's original expression (they originally differed on abnormal input such as a missing data field or a non-object). */
  normalizeResponse: (res: any) => Knowledge[];
  /** The submitted and stored values of the tag options; the option labels still use the knowledge.general/business/tech messages. */
  tagValues: { general: string; business: string; tech: string };
  /** When not loaded and empty, hide the table/cards and show the empty state (otherwise the empty table or card container stays visible). */
  showEmptyState: boolean;
  /** Original count text at the end of the partial batch-delete failure message. */
  batchDeleteFailureSuffix: (failed: number, total: number) => string;
}
