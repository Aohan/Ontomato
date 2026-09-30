import { spawn } from "node:child_process";
import path from "node:path";
import type { AgentTool } from "../../../../../../core/agent-loop/index";
import { runtimeRoot } from "../../../../../../content/layout";
import { tApp } from "../../../../../../i18n";


const DEFAULT_TIMEOUT = 60_000; // 60 seconds
const MAX_OUTPUT_BYTES = 256 * 1024; // 256KB

export function createBashTool(): AgentTool {
  return {
  name: "bash",
  description:
    tApp("diag.observe.agent.tools.builtin.bash-tool.0"),
  parameters: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: tApp("diag.observe.agent.tools.builtin.bash-tool.1"),
      },
      cwd: {
        type: "string",
        description: tApp("diag.observe.agent.tools.builtin.bash-tool.2"),
      },
      timeout: {
        type: "number",
        description: tApp("diag.observe.agent.tools.builtin.bash-tool.3"),
      },
    },
    required: ["command"],
  },
  executionMode: "sequential",
  async execute(_toolCallId, params, signal) {
    try {
      const command = params.command as string;
      const cwd = params.cwd as string | undefined;
      const timeoutSec = params.timeout as number | undefined;

      const workDir = cwd
        ? path.isAbsolute(cwd)
          ? cwd
          : path.resolve(runtimeRoot(), cwd)
        : runtimeRoot();

      const timeoutMs = (timeoutSec ?? 60) * 1000;
      const effectiveTimeout = Math.min(Math.max(timeoutMs, 1000), DEFAULT_TIMEOUT * 5);

      const result = await runCommand(command, workDir, effectiveTimeout, signal);
      return {
        content: [{ type: "text", text: result || tApp("diag.observe.agent.tools.builtin.bash-tool.4") }],
      };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: msg }],
      };
    }
  },
};
}

function runCommand(
  command: string,
  cwd: string,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error(tApp("diag.observe.agent.tools.builtin.bash-tool.5")));
      return;
    }

    // Use platform-appropriate shell
    const isWindows = process.platform === "win32";
    const shell = isWindows ? "cmd.exe" : "/bin/bash";
    const shellArgs = isWindows ? ["/c", command] : ["-c", command];

    const child = spawn(shell, shellArgs, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    const chunks: Buffer[] = [];
    let totalBytes = 0;
    let truncated = false;

    const collectData = (data: Buffer) => {
      if (truncated) return;
      totalBytes += data.length;
      if (totalBytes > MAX_OUTPUT_BYTES) {
        truncated = true;
        // Keep only up to the limit
        const excess = totalBytes - MAX_OUTPUT_BYTES;
        const trimmed = data.slice(0, data.length - excess);
        if (trimmed.length > 0) chunks.push(trimmed);
      } else {
        chunks.push(data);
      }
    };

    child.stdout?.on("data", collectData);
    child.stderr?.on("data", collectData);

    // Timeout handling
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, timeoutMs);

    // Abort signal handling
    const onAbort = () => {
      child.kill("SIGKILL");
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    child.on("error", (err) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(new Error(tApp("diag.observe.agent.tools.builtin.bash-tool.6", { p0: err.message })));
    });

    child.on("close", (code, sig) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);

      if (signal?.aborted) {
        reject(new Error(tApp("diag.observe.agent.tools.builtin.bash-tool.5")));
        return;
      }

      let output = Buffer.concat(chunks).toString("utf-8").trimEnd();

      if (truncated) {
        output += tApp("diag.observe.agent.tools.builtin.bash-tool.7", { p0: (MAX_OUTPUT_BYTES / 1024).toFixed(0) });
      }

      if (sig === "SIGKILL" && !signal?.aborted) {
        const text = output
          ? tApp("diag.observe.agent.tools.builtin.bash-tool.8", { p0: output, p1: (timeoutMs / 1000).toFixed(0) })
          : tApp("diag.observe.agent.tools.builtin.bash-tool.9", { p0: (timeoutMs / 1000).toFixed(0) });
        reject(new Error(text));
        return;
      }

      if (code !== 0 && code !== null) {
        const text = output ? tApp("diag.observe.agent.tools.builtin.bash-tool.10", { p0: output, p1: code }) : tApp("diag.observe.agent.tools.builtin.bash-tool.11", { p0: code });
        // Non-zero exit code: still return output as text (not throw)
        // since grep returning 1 (no match) is not a real error
        resolve(text);
        return;
      }

      resolve(output);
    });
  });
}
