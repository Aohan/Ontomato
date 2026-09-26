import path from "node:path";
import type { ContentLayout } from "@ontomato/workbench-server";
import { workbenchServerResourceRoot } from "@ontomato/workbench-server/content/resources";

const shared = (...segments: string[]) => path.join(workbenchServerResourceRoot, ...segments);

/** 开源版只用公共包自带的英文默认资源。 */
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
