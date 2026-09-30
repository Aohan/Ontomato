import { runtimeDataDir } from "../../../content/layout";

export const autotestConfig = {
  get dataDir() {
    return runtimeDataDir("autotest");
  },
  concurrency: 3,
  caseTimeoutMs: 1_200_000,
} as const;
