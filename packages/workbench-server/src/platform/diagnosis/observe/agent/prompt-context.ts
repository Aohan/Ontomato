import type { SessionContext } from "@ontomato/contracts/diagnosis";
import path from "node:path";
import { renderPrompt } from "../../../../core/prompts/loader";
import { observeConfig } from "../config";
import { KNOWLEDGE_INDEX_RELATIVE_PATH } from "./knowledge-store";
import { getDiagnosisSkillsIndex } from "./runtime-registry";
import { tApp } from "../../../../i18n";


export function buildLogPaths(): string {
  const { logDir, appLogFile, llmLogFile } = observeConfig;
  const appLogPath = path.join(logDir, appLogFile);
  const llmLogPath = path.join(logDir, llmLogFile);
  return [
    tApp("diag.observe.agent.prompt-context.0", { p0: appLogPath }),
    tApp("diag.observe.agent.prompt-context.1", { p0: llmLogPath }),
  ].join("\n");
}

export function buildSystemPrompt(skillsIndex = getDiagnosisSkillsIndex()): string {
  return renderPrompt("diagnosis-agent.main.system", {
    skills_index: skillsIndex,
    log_paths: buildLogPaths(),
    knowledge_index_path: KNOWLEDGE_INDEX_RELATIVE_PATH,
  });
}

export function buildLocationBlock(context?: SessionContext): string {
  if (!context || context.page === "general") {
    return "";
  }

  const pageLabel = context.page === "observe" ? tApp("diag.observe.agent.prompt-context.2") : tApp("diag.observe.agent.prompt-context.3");
  const artifactRoot =
    context.page === "observe" && context.targetKey
      ? `data/traces/${context.targetKey}`
      : context.page === "autotest" && context.targetKey?.includes("/")
        ? `data/autotest/runs/${context.targetKey}`
        : undefined;
  const lines = [
    tApp("diag.observe.agent.prompt-context.4", { p0: context.page, p1: pageLabel }),
    context.targetKey ? `targetKey=${context.targetKey}` : null,
    artifactRoot ? `artifactRoot=${artifactRoot}` : null,
  ].filter((line): line is string => Boolean(line));

  if (context.page === "observe" && context.targetKey) {
    lines.push(tApp("diag.observe.agent.prompt-context.5"));
  } else if (context.page === "autotest" && context.targetKey) {
    lines.push(tApp("diag.observe.agent.prompt-context.6"));
  }

  if (artifactRoot) {
    lines.push(tApp("diag.observe.agent.prompt-context.7"));
  }

  if (lines.length === 0) {
    return "";
  }

  return tApp("diag.observe.agent.prompt-context.8", { p0: lines.join("\n") });
}

export function sessionSystemPrompt(skillsIndex: string, context?: SessionContext): string {
  const locationBlock = buildLocationBlock(context);
  return buildSystemPrompt(skillsIndex) + (locationBlock ? `\n\n${locationBlock}` : "");
}
