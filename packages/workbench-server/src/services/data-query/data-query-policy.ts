import type { AbcQuestionMode } from "@ontomato/contracts/system-model";
import { getSystemModelConfig } from "../../config/system-model";
export function isAbcHarnessEnabled(): boolean {
  return getAbcQuestionMode() === "harness";
}
export function getAbcQuestionMode(): AbcQuestionMode {
  return getSystemModelConfig().abcQuestionMode;
}
export function getQueryTimeoutMs(): number {
  return getSystemModelConfig().queryTimeoutSeconds * 1000;
}
export function isAbcNoToolFixedMode(): boolean {
  return getAbcQuestionMode() === "no_tool_fixed";
}
