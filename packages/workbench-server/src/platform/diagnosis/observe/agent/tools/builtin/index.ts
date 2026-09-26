import type { AgentTool } from "../../../../../../core/agent-loop/index";
import { createReadTool } from "./read-tool";
import { createWriteTool } from "./write-tool";
import { createEditTool } from "./edit-tool";
import { createBashTool } from "./bash-tool";
import { createGrepTool } from "./grep-tool";
import { createFindTool } from "./find-tool";
import { createLsTool } from "./ls-tool";

/** All 7 builtin tools (read, write, edit, bash, grep, find, ls) */
export function createBuiltinTools(): AgentTool[] {
  return [
    createReadTool(),
    createWriteTool(),
    createEditTool(),
    createBashTool(),
    createGrepTool(),
    createFindTool(),
    createLsTool(),
  ];
}
