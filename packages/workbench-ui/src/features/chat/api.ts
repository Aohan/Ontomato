import type { ThreadListResponse } from "@ontomato/contracts/chat";
import {
  createEventSource,
  nodeApiDelete,
  nodeApiFetch,
  nodeApiGet,
  nodeApiPut,
} from "../../utils/api";
import { apiUrl } from "../../utils/api-base";

export const chatApi = {
  listThreads: (limit: number, offset: number): Promise<ThreadListResponse> =>
    nodeApiGet(`/threads?limit=${limit}&offset=${offset}&threadType=qa`),
  getThreadMessages: (threadId: string) => nodeApiFetch(`/threads/${threadId}/messages`, "GET"),
  deleteThread: (threadId: string) => nodeApiDelete(`/threads/${threadId}`),
  renameThread: (threadId: string, title: string) =>
    nodeApiPut(`/threads/${threadId}/title`, { title }),
  cancelRun: (threadId: string, runId?: string) => {
    const runQuery = runId ? `?runId=${encodeURIComponent(runId)}` : "";
    return nodeApiFetch(
      `/chat/${encodeURIComponent(threadId)}/cancel${runQuery}`,
      "POST",
      runId ? { runId } : undefined
    );
  },
  openStream: (params: URLSearchParams) => createEventSource(apiUrl(`/chat?${params.toString()}`)),
  openResumeStream: (threadId: string, params: URLSearchParams) =>
    createEventSource(apiUrl(`/chat/${encodeURIComponent(threadId)}/stream?${params.toString()}`)),
};
