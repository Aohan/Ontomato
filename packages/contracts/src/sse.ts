/** Named SSE control payloads; open/heartbeat are SSE event names, not JSON type values. */
export type SseOpenData = { ok: true };
export type SseHeartbeatData = { ts: number };
