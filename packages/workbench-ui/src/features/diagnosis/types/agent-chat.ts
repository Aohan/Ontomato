import type { SessionHistorySnapshot } from "@ontomato/contracts/diagnosis";
export type DiagnosisResponseStatus = SessionHistorySnapshot["responseStatus"] | "starting";
