import fs from "node:fs";
import path from "node:path";
import type { AgentTool } from "../../../../../../core/agent-loop/index";
import { runtimeRoot } from "../../../../../../content/layout";
import { tApp } from "../../../../../../i18n";


export function createWriteTool(): AgentTool {
  return {
  name: "write",
  description: tApp("diag.observe.agent.tools.builtin.write-tool.0"),
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: tApp("diag.observe.agent.tools.builtin.write-tool.1"),
      },
      content: {
        type: "string",
        description: tApp("diag.observe.agent.tools.builtin.write-tool.2"),
      },
    },
    required: ["path", "content"],
  },
  async execute(_toolCallId, params) {
    try {
      const filePath = params.path as string;
      const content = params.content as string;

      const absolutePath = path.isAbsolute(filePath)
        ? filePath
        : path.resolve(runtimeRoot(), filePath);

      // Create parent directories if needed
      const dir = path.dirname(absolutePath);
      fs.mkdirSync(dir, { recursive: true });

      // Write file
      fs.writeFileSync(absolutePath, content, "utf-8");

      const bytes = Buffer.byteLength(content, "utf-8");
      return {
        content: [
          {
            type: "text",
            text: tApp("diag.observe.agent.tools.builtin.write-tool.3", { p0: bytes, p1: filePath }),
          },
        ],
      };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: tApp("diag.observe.agent.tools.builtin.write-tool.4", { p0: msg }) }],
      };
    }
  },
};
}
