import type { SkillOutput } from "@ontomato/contracts/skills";
import { SkillCategory, SkillType } from "../../../core/skills/constants";
import { loadSkillContent } from "../../../core/skills/discovery/loader";
import { skillRuntime } from "../../../core/skills/index";
import { skillRegistryManager } from "../../../core/skills/registry/manager";
import type { SkillInput, SkillMeta } from "../../../core/skills/types";
import { createLogger } from "../../../logging/logger";
import { tApp } from "../../../i18n";


const logger = createLogger("analysis-skill-executor");

export interface AnalysisSkillInput extends SkillInput {
  dimensionName?: string;
  dimensionValue?: string;
  dimensionReport?: string;
  [key: string]: any;
}

export interface AnalysisSkillResult {
  success: boolean;
  skillId: string;
  result?: any;
  error?: string;
}

export class AnalysisSkillExecutor {
  async executeSkill(
    domainId: string,
    skillId: string,
    input: AnalysisSkillInput,
    selectedSkillIds: readonly string[]
  ): Promise<AnalysisSkillResult> {
    try {
      const registry = await skillRegistryManager.forDomain(domainId);
      const skill = registry.resolveSkill(skillId, {
        category: SkillCategory.ANALYSIS,
        selectedSkillIds,
      });

      logger.info(
        tApp("analysis.dimension.skill-executor.185", { id: skill.id, type: skill.manifest.type, category: skill.manifest.category })
      );

      if (skill.manifest.type === SkillType.KNOWLEDGE) {
        return this.executeKnowledgeSkill(skill);
      }
      return this.executeExecutableSkill(domainId, skill, input, selectedSkillIds);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(tApp("analysis.dimension.skill-executor.186", { skillId: skillId }), errorMessage);
      return { success: false, skillId, error: errorMessage };
    }
  }

  private executeKnowledgeSkill(skill: SkillMeta): AnalysisSkillResult {
    const content = loadSkillContent(skill);
    if (!content) {
      return { success: false, skillId: skill.id, error: tApp("analysis.dimension.skill-executor.187", { id: skill.id }) };
    }

    return {
      success: true,
      skillId: skill.id,
      result: {
        type: "knowledge",
        content,
        methodology: this.extractMethodology(content),
      },
    };
  }

  private async executeExecutableSkill(
    domainId: string,
    skill: SkillMeta,
    input: AnalysisSkillInput,
    selectedSkillIds: readonly string[]
  ): Promise<AnalysisSkillResult> {
    const datasets =
      input.datasets?.filter((dataset) => isRowDataset(dataset.data)) ??
      (isRowDataset(input.data) ? [{ data: input.data }] : []);
    if (datasets.length === 0) {
      return { success: false, skillId: skill.id, error: tApp("analysis.dimension.skill-executor.188") };
    }

    const outputs = [];
    for (const dataset of datasets) {
      const output = await skillRuntime.execute(
        domainId,
        skill.id,
        {
          ...input,
          data: dataset.data,
          datasets: undefined,
        },
        {
          type: SkillType.EXECUTABLE,
          category: SkillCategory.ANALYSIS,
          selectedSkillIds,
        }
      );
      const payload = this.unwrapOutput(output);
      const declaredError = this.getDeclaredError(payload);
      outputs.push({
        title: dataset.title,
        dimensionId: dataset.dimensionId,
        dimensionName: dataset.dimensionName,
        subQuestion: dataset.subQuestion,
        success: !declaredError,
        error: declaredError,
        output: payload,
      });
    }

    if (outputs.every((output) => !output.success)) {
      return {
        success: false,
        skillId: skill.id,
        error: outputs
          .map((output) => output.error)
          .filter(Boolean)
          .join(tApp("analysis.dimension.abc-replay.39")),
      };
    }

    return {
      success: true,
      skillId: skill.id,
      result: {
        type: "executable",
        skillId: skill.id,
        outputs,
      },
    };
  }

  private unwrapOutput(output: SkillOutput): unknown {
    return output.json ?? output.text ?? output.html ?? output;
  }

  private getDeclaredError(output: unknown): string | undefined {
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

  private extractMethodology(content: string): string[] {
    return content
      .split("\n")
      .filter((line) => line.startsWith("## ") || line.startsWith("### "))
      .map((line) => line.replace(/^#+ /, ""));
  }

  async executeMultipleSkills(
    domainId: string,
    skillIds: string[],
    input: AnalysisSkillInput
  ): Promise<AnalysisSkillResult[]> {
    const results: AnalysisSkillResult[] = [];
    for (const skillId of skillIds) {
      results.push(await this.executeSkill(domainId, skillId, input, skillIds));
    }
    return results;
  }
}

export const analysisSkillExecutor = new AnalysisSkillExecutor();

function isRowDataset(value: unknown): value is Record<string, unknown>[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((row) => row !== null && typeof row === "object" && !Array.isArray(row))
  );
}
