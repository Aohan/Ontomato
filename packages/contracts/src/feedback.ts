export type FeedbackSourceType = "qa" | "analysis_task";

export type FeedbackRating = "like" | "dislike";

export interface FeedbackRecord {
  id: string;
  sourceType: FeedbackSourceType;
  targetId: string;
  threadId?: string;
  requestSeq?: number;
  taskId?: string;
  rating: FeedbackRating;
  userId: string;
  userName?: string;
  userInput?: string;
  assistantOutput?: string;
  feedbackText?: string;
  metadata?: unknown;
  createdAt: number;
}

export interface FeedbackPage {
  records: FeedbackRecord[];
  total: number;
  limit: number;
  offset: number;
}
