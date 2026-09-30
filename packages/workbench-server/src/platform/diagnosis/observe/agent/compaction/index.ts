import type { CompactionPromptKeys } from "../../../../../core/agent-loop/compaction/types";

export const DIAGNOSIS_COMPACTION_PROMPT_KEYS: CompactionPromptKeys = {
  system: "diagnosis-agent.compaction.system",
  summarize: "diagnosis-agent.compaction.summarize.user",
  update: "diagnosis-agent.compaction.update.user",
};

export { diagnosisSummaryNote } from "./summary-note";
export {
  computeFileLists,
  createFileOps,
  extractFileOpsFromMessage,
  formatFileOperations,
} from "./file-ops";
