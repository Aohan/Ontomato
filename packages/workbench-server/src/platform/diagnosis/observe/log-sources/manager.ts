import { workbenchProduct } from "../../../../product/installed";
import type {
  LogSourceProbeResult,
  LogSource,
  LogSourceConfig,
} from "@ontomato/contracts/observe";
/**
 * Log source manager.
 *
 * Manages three types of log sources:
 * - data-agent main log (data-agent.log)
 * - data-agent LLM log (data-agent_llm.jsonl)
 * - backend service logs (via datarag Node API)
 */

import fs from "node:fs";
import path from "node:path";
import { createLogger } from "../../../../logging/logger";
import { observeConfig, getLogSourceConfig } from "../config";

import {
  listBackendTailNodes,
  probeBackendTailStream,
  type BackendNodeRequestOptions,
} from "./backend-node-client";

const logger = createLogger("observe:log-sources");

/**
 * List all log sources with their current availability status.
 */
export function listLogSources(): LogSource[] {
  const cfg = getLogSourceConfig();
  const sources: LogSource[] = [];

  // 1. data-agent main log
  const appLogPath = path.join(observeConfig.logDir, observeConfig.appLogFile);
  const appAvailable = fileExists(appLogPath);
  sources.push({
    sourceType: workbenchProduct().appLogSourceType,
    path: appLogPath,
    displayName: "Data-Agent Main Log",
    available: appAvailable,
    error: appAvailable ? undefined : `File not found: ${appLogPath}`,
  });

  // 2. data-agent LLM log
  const llmLogPath = path.join(observeConfig.logDir, observeConfig.llmLogFile);
  const llmAvailable = fileExists(llmLogPath);
  sources.push({
    sourceType: workbenchProduct().llmLogSourceType,
    path: llmLogPath,
    displayName: "Data-Agent LLM Log",
    available: llmAvailable,
    error: llmAvailable ? undefined : `File not found: ${llmLogPath}`,
  });

  // 3. Backend logs via datarag Node API. Session registry is only a route/window hint.
  const backendNodes = listBackendTailNodes(cfg);
  sources.push({
    sourceType: "backend-node-api",
    url: backendNodes[0]?.baseUrl,
    displayName: "Backend Logs (Node API)",
    available: backendNodes.length > 0,
    error: backendNodes.length > 0 ? undefined : "Backend node API baseUrl is not configured",
  });

  return sources;
}

/**
 * Probe a specific log source for connectivity / readability.
 */
export async function probeLogSource(
  sourceType: LogSource["sourceType"],
  options: BackendNodeRequestOptions = {}
): Promise<LogSourceProbeResult> {
  const cfg = getLogSourceConfig();

  const product = workbenchProduct();
  if (sourceType === product.appLogSourceType) {
    return probeFile(path.join(observeConfig.logDir, observeConfig.appLogFile));
  }
  if (sourceType === product.llmLogSourceType) {
    return probeFile(path.join(observeConfig.logDir, observeConfig.llmLogFile));
  }
  if (sourceType === "backend-node-api") {
      const result = await probeBackendNodeApi(cfg, options);
      logger.info("Backend Node API probe result", {
        ok: result.ok,
        nodeCount: result.detail?.nodeCount,
      });
    return result;
  }
  return { ok: false, error: `Unknown source type: ${sourceType}` };
}

/**
 * Probe all configured log sources at once.
 */
export async function probeAllLogSources(
  options: BackendNodeRequestOptions = {}
): Promise<Array<{ sourceType: string; ok: boolean; error?: string }>> {
  const cfg = getLogSourceConfig();
  const results: Array<{ sourceType: string; ok: boolean; error?: string }> = [];

  // Local file probes (sync)
  results.push({
    sourceType: workbenchProduct().appLogSourceType,
    ...probeFile(path.join(observeConfig.logDir, observeConfig.appLogFile)),
  });
  results.push({
    sourceType: workbenchProduct().llmLogSourceType,
    ...probeFile(path.join(observeConfig.logDir, observeConfig.llmLogFile)),
  });

  const backendResult = await probeBackendNodeApi(cfg, options);
  results.push({
    sourceType: "backend-node-api",
    ok: backendResult.ok,
    error: backendResult.error,
  });

  return results;
}

/* ------------------------------------------------------------------ */
/*  Internal helpers                                                  */
/* ------------------------------------------------------------------ */

function fileExists(filePath: string): boolean {
  try {
    return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function probeFile(filePath: string): { ok: boolean; error?: string } {
  try {
    if (!fs.existsSync(filePath)) {
      return { ok: false, error: `File not found: ${filePath}` };
    }
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) {
      return { ok: false, error: `Not a file: ${filePath}` };
    }
    // Try reading a small chunk
    const fd = fs.openSync(filePath, "r");
    try {
      const buf = Buffer.alloc(1);
      fs.readSync(fd, buf, 0, 1, 0);
    } finally {
      fs.closeSync(fd);
    }
    return { ok: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { ok: false, error: msg };
  }
}

async function probeBackendNodeApi(
  cfg: LogSourceConfig,
  options: BackendNodeRequestOptions
): Promise<LogSourceProbeResult> {
  const nodes = listBackendTailNodes(cfg);
  if (nodes.length === 0) {
    return { ok: false, error: "Backend node API baseUrl is not configured" };
  }

  const failures: Array<{ nodeId: string; error: string }> = [];
  await Promise.all(
    nodes.map(async (node) => {
      try {
        await probeBackendTailStream({
          node,
          options: { ...options, timeoutMs: options.timeoutMs ?? 60_000 },
        });
      } catch (error) {
        failures.push({
          nodeId: node.nodeId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    })
  );

  const detail = {
    nodeCount: nodes.length,
    ...(failures.length > 0 ? { failures } : {}),
  };

  if (failures.length > 0) {
    return {
      ok: false,
      error: `${failures.length}/${nodes.length} backend node API probe(s) failed`,
      detail,
    };
  }

  return { ok: true, detail };
}
