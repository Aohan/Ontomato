export interface SseErrorEvent {
  type: "error";
  error: string;
  timestamp: number;
}
