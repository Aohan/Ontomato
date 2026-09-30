import type { DeepAnalysisArtifactStore } from "../task/artifacts";
import type { SkillOutput } from "@ontomato/contracts/skills";
import fs from "fs";
import path from "path";
import type { AgentTool, AgentToolResult } from "../../../core/agent-loop/types";
import {
  SkillCategory,
  SkillType,
  skillRegistryManager,
  skillRuntime,
  type SkillMeta,
} from "../../../core/skills";
import { normalizeSkillPackagePath, parseSkillMarkdown } from "../../../core/skills/manifest";
import type { QueryResultDatasetEntry } from "../runtime/query-result";
import { tApp } from "../../../i18n";


export interface LoopSkillEvidenceRecord {
  question: string;
  entries: QueryResultDatasetEntry[];
}

export interface LoopSkillDeps {
  trajectory: Pick<DeepAnalysisArtifactStore, "start" | "settle">;
  domainId: string;
  selectedSkillIds: readonly string[];
  resolveEvidence: (questionId: string) => LoopSkillEvidenceRecord | undefined;
}

/** Assembles the skill index, prompts, and tool surface shared by supervisor and workers, per the agent's selection. */
export async function assembleLoopSkillCapability(deps: LoopSkillDeps) {
  const registry = await skillRegistryManager.forDomain(deps.domainId);
  const availableSkills = registry.getSkills({
    category: SkillCategory.ANALYSIS,
    selectedSkillIds: deps.selectedSkillIds,
  });
  const tools = availableSkills.length > 0 ? createLoopSkillTools(deps) : [];
  return {
    prompt: buildLoopSkillCapabilityPrompt(availableSkills),
    supervisorTools: tools,
    workerTools: tools,
  };
}

function textResult(text: string): AgentToolResult {
  return { content: [{ type: "text", text }] };
}

function requiredString(params: Record<string, unknown>, key: string): string | null {
  const value = typeof params[key] === "string" ? params[key].trim() : "";
  return value || null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function resolveAnalysisSkill(
  deps: LoopSkillDeps,
  skillId: string,
  type?: typeof SkillType.EXECUTABLE
): Promise<SkillMeta> {
  const registry = await skillRegistryManager.forDomain(deps.domainId);
  return registry.resolveSkill(skillId, {
    ...(type ? { type } : {}),
    category: SkillCategory.ANALYSIS,
    selectedSkillIds: deps.selectedSkillIds,
  });
}

export function buildLoopSkillCapabilityPrompt(skills: SkillMeta[]): string {
  if (skills.length === 0) return "";

  const index = skills.map((skill) => {
    const executableHint =
      skill.manifest.type === SkillType.EXECUTABLE
        ? tApp("analysis.loop.skills.350", { join: skill.manifest.entries.map((entry) => `\`${entry}\``).join(tApp("analysis.dimension.dimension-engine.63")) })
        : tApp("analysis.loop.skills.351");
    return tApp("analysis.loop.skills.352", { name: skill.manifest.name, description: skill.manifest.description, executableHint: executableHint });
  });

  return [
    tApp("analysis.loop.skills.353"),
    ...index,
    "",
    tApp("analysis.loop.skills.354"),
    "",
  ].join("\n");
}

function createLoadSkillTool(deps: LoopSkillDeps): AgentTool {
  return {
    name: "load_skill",
    description:
      tApp("analysis.loop.skills.355"),
    parameters: {
      type: "object",
      properties: {
        skill_id: { type: "string", description: tApp("analysis.loop.skills.356") },
      },
      required: ["skill_id"],
    },
    async execute(_toolCallId: string, params: Record<string, unknown>, signal?: AbortSignal) {
      const skillId = requiredString(params, "skill_id");
      if (!skillId) return textResult(tApp("analysis.loop.skills.357"));

      const activityId = deps.trajectory.start("skill", {
        skills: [{ skillId, action: "load", entry: "SKILL.md", status: "running" }],
      });
      const result = (text: string, success = false) => {
        const status = success ? "completed" : "failed";
        deps.trajectory.settle(activityId, status, {
          error: success ? undefined : text,
          skills: [
            {
              skillId,
              action: "load",
              entry: "SKILL.md",
              status,
              error: success ? undefined : text,
            },
          ],
        });
        return textResult(text);
      };
      try {
        signal?.throwIfAborted();
        const skill = await resolveAnalysisSkill(deps, skillId);
        if (!skill.skillMdPath) {
          return result(tApp("analysis.loop.skills.358", { skillId: skillId }));
        }
        const parsed = parseSkillMarkdown(await fs.promises.readFile(skill.skillMdPath, "utf-8"));
        signal?.throwIfAborted();
        if (!parsed) return result(tApp("analysis.loop.skills.359", { skillId: skillId }));
        return result(parsed.content.trim(), true);
      } catch (error: unknown) {
        return result(tApp("analysis.loop.skills.360", { errorMessage: errorMessage(error) }));
      }
    },
  };
}

function createReadSkillFileTool(deps: LoopSkillDeps): AgentTool {
  return {
    name: "read_skill_file",
    description:
      tApp("analysis.loop.skills.361"),
    parameters: {
      type: "object",
      properties: {
        skill_id: { type: "string", description: tApp("analysis.loop.skills.356") },
        path: { type: "string", description: tApp("analysis.loop.skills.362") },
      },
      required: ["skill_id", "path"],
    },
    async execute(_toolCallId: string, params: Record<string, unknown>, signal?: AbortSignal) {
      const skillId = requiredString(params, "skill_id");
      const requestedPath = requiredString(params, "path");
      if (!skillId) return textResult(tApp("analysis.loop.skills.363"));
      if (!requestedPath) return textResult(tApp("analysis.loop.skills.364"));

      try {
        signal?.throwIfAborted();
        const skill = await resolveAnalysisSkill(deps, skillId);
        const portablePath = requestedPath.replace(/\\/g, "/");
        if (path.posix.isAbsolute(portablePath) || /^[A-Za-z]:\//.test(portablePath)) {
          return textResult(tApp("analysis.loop.skills.365"));
        }
        if (portablePath.split("/").includes("..")) {
          return textResult(tApp("analysis.loop.skills.366"));
        }

        const relativePath = normalizeSkillPackagePath(requestedPath);
        if (!relativePath) {
          return textResult(tApp("analysis.loop.skills.367"));
        }

        const packageRealPath = await fs.promises.realpath(skill.path);
        let targetRealPath: string;
        try {
          targetRealPath = await fs.promises.realpath(path.join(packageRealPath, relativePath));
        } catch {
          return textResult(tApp("analysis.loop.skills.368", { relativePath: relativePath }));
        }

        const containment = path.relative(packageRealPath, targetRealPath);
        if (
          containment === ".." ||
          containment.startsWith(`..${path.sep}`) ||
          path.isAbsolute(containment)
        ) {
          return textResult(tApp("analysis.loop.skills.369"));
        }

        const stat = await fs.promises.stat(targetRealPath);
        if (!stat.isFile()) {
          return textResult(tApp("analysis.loop.skills.370", { relativePath: relativePath }));
        }
        const content = await fs.promises.readFile(targetRealPath, "utf-8");
        signal?.throwIfAborted();
        return textResult(content);
      } catch (error: unknown) {
        return textResult(tApp("analysis.loop.skills.371", { errorMessage: errorMessage(error) }));
      }
    },
  };
}

function unwrapSkillOutput(output: SkillOutput): unknown {
  return output.json ?? output.text ?? output.html ?? output;
}

function declaredSkillError(output: unknown): string | undefined {
  if (
    output &&
    typeof output === "object" &&
    "success" in output &&
    (output as { success?: boolean }).success === false
  ) {
    return String((output as { error?: unknown }).error ?? tApp("analysis.dimension.skill-executor.189"));
  }
  return undefined;
}

function createRunSkillTool(deps: LoopSkillDeps): AgentTool {
  return {
    name: "run_skill",
    description:
      tApp("analysis.loop.skills.372"),
    parameters: {
      type: "object",
      properties: {
        skill_id: { type: "string", description: tApp("analysis.loop.skills.373") },
        question_id: {
          type: "string",
          description: tApp("analysis.loop.skills.374"),
        },
        entry: {
          type: "string",
          description: tApp("analysis.loop.skills.375"),
        },
      },
      required: ["skill_id", "question_id"],
    },
    async execute(_toolCallId: string, params: Record<string, unknown>, signal?: AbortSignal) {
      const skillId = requiredString(params, "skill_id");
      const questionId = requiredString(params, "question_id");
      const requestedEntry = requiredString(params, "entry");
      if (!skillId) return textResult(tApp("analysis.loop.skills.376"));
      if (!questionId) return textResult(tApp("analysis.loop.skills.377"));
      if (params.entry !== undefined && !requestedEntry) {
        return textResult(tApp("analysis.loop.skills.378"));
      }

      let entry = requestedEntry || undefined;
      const activityId = deps.trajectory.start("skill", {
        skills: [{ skillId, action: "run", entry, status: "running" }],
      });
      const result = (text: string, success = false) => {
        const status = success ? "completed" : "failed";
        deps.trajectory.settle(activityId, status, {
          error: success ? undefined : text,
          skills: [{ skillId, action: "run", entry, status, error: success ? undefined : text }],
        });
        return textResult(text);
      };
      try {
        signal?.throwIfAborted();
        const skill = await resolveAnalysisSkill(deps, skillId, SkillType.EXECUTABLE);
        if (skill.manifest.type !== SkillType.EXECUTABLE) {
          return result(tApp("analysis.loop.skills.379", { skillId: skillId }));
        }
        entry = requestedEntry ?? skill.manifest.entries[0];
        if (!skill.manifest.entries.includes(entry)) {
          return result(
            tApp("analysis.loop.skills.380", { entry: entry, skillId: skillId })
          );
        }

        const evidence = deps.resolveEvidence(questionId);
        if (!evidence) {
          return result(
            tApp("analysis.loop.skills.381", { questionId: questionId })
          );
        }
        const datasets = evidence.entries.filter((item) => item.data.length > 0);
        if (datasets.length === 0) {
          return result(
            tApp("analysis.loop.skills.382", { questionId: questionId })
          );
        }

        const outputs: Array<{
          dataset: string;
          success: boolean;
          output?: unknown;
          error?: string;
        }> = [];
        for (const dataset of datasets) {
          signal?.throwIfAborted();
          try {
            const output = await skillRuntime.execute(
              deps.domainId,
              skillId,
              { query: evidence.question, title: dataset.title, data: dataset.data },
              {
                type: SkillType.EXECUTABLE,
                category: SkillCategory.ANALYSIS,
                selectedSkillIds: deps.selectedSkillIds,
              },
              { entry, maxRetries: 0, signal }
            );
            signal?.throwIfAborted();
            const payload = unwrapSkillOutput(output);
            const declaredError = declaredSkillError(payload);
            outputs.push(
              declaredError
                ? { dataset: dataset.title, success: false, error: declaredError }
                : { dataset: dataset.title, success: true, output: payload }
            );
          } catch (error: unknown) {
            outputs.push({ dataset: dataset.title, success: false, error: errorMessage(error) });
          }
        }

        signal?.throwIfAborted();
        const successCount = outputs.filter((output) => output.success).length;
        return result(
          [
            tApp("analysis.loop.skills.383", { value: successCount > 0 ? tApp("analysis.loop.skills.384") : tApp("analysis.loop.skills.385"), skillId: skillId, entry: entry, successCount: successCount, length: outputs.length }),
            JSON.stringify(outputs, null, 2),
          ].join("\n"),
          successCount > 0
        );
      } catch (error: unknown) {
        return result(tApp("analysis.loop.skills.386", { errorMessage: errorMessage(error) }));
      }
    },
  };
}

export function createLoopSkillTools(deps: LoopSkillDeps): AgentTool[] {
  return [createLoadSkillTool(deps), createReadSkillFileTool(deps), createRunSkillTool(deps)];
}
