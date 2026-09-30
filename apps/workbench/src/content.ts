import path from "node:path";
import type { ContentLayout } from "@ontomato/workbench-server";
import { workbenchServerResourceRoot } from "@ontomato/workbench-server/content/resources";

const shared = (...segments: string[]) => path.join(workbenchServerResourceRoot, ...segments);

/** The OSS edition uses only the shared package's built-in English default resources. */
export function ossContentLayout(runtimeRoot: string): ContentLayout {
  return {
    runtimeRoot,
    prompts: [{ from: shared("prompts"), to: "." }],
    skillTemplate: [{ from: shared("skills"), to: "." }],
    runtimeResources: [
      { from: shared("data", "echart"), to: "echart" },
      { from: shared("data", "knowledge"), to: "knowledge" },
      { from: shared("data", "skills"), to: "skills" },
    ],
  };
}
