import fs from "node:fs";
import path from "node:path";
import type { AgentTool } from "../../../../../../core/agent-loop/index";
import { runtimeRoot } from "../../../../../../content/layout";
import { tApp } from "../../../../../../i18n";


export function createEditTool(): AgentTool {
  return {
  name: "edit",
  description:
    tApp("diag.observe.agent.tools.builtin.edit-tool.0"),
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: tApp("diag.observe.agent.tools.builtin.edit-tool.1"),
      },
      old_string: {
        type: "string",
        description: tApp("diag.observe.agent.tools.builtin.edit-tool.2"),
      },
      new_string: {
        type: "string",
        description: tApp("diag.observe.agent.tools.builtin.edit-tool.3"),
      },
    },
    required: ["path", "old_string", "new_string"],
  },
  async execute(_toolCallId, params) {
    try {
      const filePath = params.path as string;
      const oldString = params.old_string as string;
      const newString = params.new_string as string;

      const absolutePath = path.isAbsolute(filePath)
        ? filePath
        : path.resolve(runtimeRoot(), filePath);

      // Check file exists
      if (!fs.existsSync(absolutePath)) {
        return {
          content: [{ type: "text", text: tApp("diag.tool.fileMissing", { p0: filePath }) }],
        };
      }

      const stat = fs.statSync(absolutePath);
      if (stat.isDirectory()) {
        return {
          content: [{ type: "text", text: tApp("diag.observe.agent.tools.builtin.edit-tool.5", { p0: filePath }) }],
        };
      }

      // Read file
      const content = fs.readFileSync(absolutePath, "utf-8");

      // Count occurrences
      let count = 0;
      let searchFrom = 0;
      while (true) {
        const idx = content.indexOf(oldString, searchFrom);
        if (idx === -1) break;
        count++;
        searchFrom = idx + oldString.length;
      }

      if (count === 0) {
        // Show a snippet of the file for debugging
        const preview = content.slice(0, 200);
        return {
          content: [
            {
              type: "text",
              text: tApp("diag.observe.agent.tools.builtin.edit-tool.6", { p0: preview, p1: content.length > 200 ? "..." : "" }),
            },
          ],
        };
      }

      if (count > 1) {
        return {
          content: [
            {
              type: "text",
              text: tApp("diag.observe.agent.tools.builtin.edit-tool.7", { p0: count }),
            },
          ],
        };
      }

      // Perform replacement
      const newContent = content.replace(oldString, newString);
      fs.writeFileSync(absolutePath, newContent, "utf-8");

      // Find the line number of the change
      const beforeChange = content.slice(0, content.indexOf(oldString));
      const lineNumber = beforeChange.split("\n").length;

      return {
        content: [
          {
            type: "text",
            text: tApp("diag.tool.editReplaced", { file: filePath, line: lineNumber }),
          },
        ],
      };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: tApp("diag.observe.agent.tools.builtin.edit-tool.8", { p0: msg }) }],
      };
    }
  },
};
}
