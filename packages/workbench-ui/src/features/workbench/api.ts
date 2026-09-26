import type { WorkbenchAppearance } from "@ontomato/contracts/workbench-appearance";
import { nodeApiGet, nodeApiPost } from "../../utils/api";

export function getWorkbenchAppearance(): Promise<WorkbenchAppearance> {
  return nodeApiGet("/workbench-appearance");
}

export function saveWorkbenchAppearance(value: WorkbenchAppearance): Promise<WorkbenchAppearance> {
  return nodeApiPost("/workbench-appearance", value);
}
