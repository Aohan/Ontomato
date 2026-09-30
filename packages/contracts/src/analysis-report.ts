export interface AnalysisReportHotCard {
  id: string;
  question: string;
  dimensions: Array<{
    dimensionId: string;
    dimensionName: string;
    dimensionValue: string;
    reason?: string;
    subQuestions: Array<{
      id: string;
      dimensionId: string;
      dimensionName?: string;
      dimensionValue?: string;
      subQuestion: string;
      originalQuestion?: string;
      dataCount?: number;
      status?: string;
      statusText?: string;
      queryRunRef?: {
        queryRunId?: string;
        threadId: string;
        requestSeq: number;
        sourceKind: string;
        sourceRef: string;
      };
    }>;
  }>;
  reportContent: string;
  status: "PENDING_REVIEW" | "PUBLISHED" | "UNUSED";
  businessDescription: string;
  agentId: string;
  sessionId: string;
  createdAt: number;
  updatedAt: number;
}

export interface AnalysisReportHotCardSummary {
  id: string;
  question: string;
  status: AnalysisReportHotCard["status"];
  businessDescription: string;
  agentId: string;
  dimensions: string[];
  questionTotal: number;
  createdAt: number;
  updatedAt: number;
}

export interface AnalysisReportCardSummary extends AnalysisReportHotCardSummary {
  agentName: string;
}
