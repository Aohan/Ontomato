import type {
  FeedbackSourceType,
  FeedbackRating,
  FeedbackRecord,
  FeedbackPage,
} from "@ontomato/contracts/feedback";
export type FeedbackPayload = Omit<FeedbackRecord, "id" | "userId" | "userName" | "createdAt">;
import api from "./index";

export interface FeedbackCancelPayload {
  sourceType: FeedbackSourceType;
  targetId: string;
  threadId?: string;
  requestSeq?: number;
  taskId?: string;
  turnKey?: string;
}

export const feedbackApi = {
  async submit(payload: FeedbackPayload): Promise<FeedbackRecord> {
    const res = await api.post("/feedback", payload);
    return res.data || res;
  },

  async cancel(payload: FeedbackCancelPayload): Promise<void> {
    const query = new URLSearchParams();
    query.set("sourceType", payload.sourceType);
    query.set("targetId", payload.targetId);
    if (payload.threadId) query.set("threadId", payload.threadId);
    if (payload.requestSeq !== undefined) query.set("requestSeq", String(payload.requestSeq));
    if (payload.taskId) query.set("taskId", payload.taskId);
    if (payload.turnKey) query.set("turnKey", payload.turnKey);
    await api.delete(`/feedback?${query.toString()}`);
  },

  async list(params?: {
    sourceType?: FeedbackSourceType | "";
    rating?: FeedbackRating | "";
    userId?: string;
    threadId?: string;
    taskId?: string;
    targetIds?: string[];
    keyword?: string;
    limit?: number;
    offset?: number;
  }): Promise<FeedbackPage> {
    const query = new URLSearchParams();
    if (params?.sourceType) query.set("sourceType", params.sourceType);
    if (params?.rating) query.set("rating", params.rating);
    if (params?.userId) query.set("userId", params.userId);
    if (params?.threadId) query.set("threadId", params.threadId);
    if (params?.taskId) query.set("taskId", params.taskId);
    if (params?.targetIds?.length) query.set("targetIds", params.targetIds.join(","));
    if (params?.keyword) query.set("keyword", params.keyword);
    if (params?.limit !== undefined) query.set("limit", String(params.limit));
    if (params?.offset !== undefined) query.set("offset", String(params.offset));
    const qs = query.toString();
    const res = await api.get(`/feedback${qs ? `?${qs}` : ""}`);
    return res.data || { records: [], total: 0, limit: params?.limit || 20, offset: 0 };
  },

  async state(params?: {
    sourceType?: FeedbackSourceType | "";
    threadId?: string;
    taskId?: string;
    targetIds?: string[];
    limit?: number;
  }): Promise<FeedbackPage> {
    const query = new URLSearchParams();
    if (params?.sourceType) query.set("sourceType", params.sourceType);
    if (params?.threadId) query.set("threadId", params.threadId);
    if (params?.taskId) query.set("taskId", params.taskId);
    if (params?.targetIds?.length) query.set("targetIds", params.targetIds.join(","));
    if (params?.limit !== undefined) query.set("limit", String(params.limit));
    const qs = query.toString();
    const res = await api.get(`/feedback/state${qs ? `?${qs}` : ""}`);
    return res.data || { records: [], total: 0, limit: params?.limit || 500, offset: 0 };
  },
};
