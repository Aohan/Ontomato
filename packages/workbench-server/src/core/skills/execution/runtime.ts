import type {
  SkillOutput,
  SkillExecutionMetrics,
  SkillMetricsSnapshot,
} from "@ontomato/contracts/skills";
import path from "path";
import { SkillType } from "../constants";
import { skillRegistryManager } from "../registry/manager";
import { executeSkill, type SkillExecutionOptions } from "./executor";
import { tApp } from "../../../i18n";
import type { SkillInput, RuntimeConfig, SkillQuery } from "../types";

const defaultConfig: RuntimeConfig = {
  skillsRoot: path.join(process.cwd(), "skills"),
  timeout: 5000,
  enableCache: true,
  maxRetries: 0,
  retryDelayMs: 1000,
};

class SkillRuntime {
  private metricsByDomain: Map<string, Map<string, SkillExecutionMetrics>> = new Map();

  constructor(private readonly config: RuntimeConfig = defaultConfig) {}

  async initialize(domainId: string): Promise<void> {
    await skillRegistryManager.forDomain(domainId);
  }

  async execute(
    domainId: string,
    skillId: string,
    input: SkillInput,
    constraints: Pick<SkillQuery, "type" | "category" | "selectedSkillIds"> = {},
    options: SkillExecutionOptions = {}
  ): Promise<SkillOutput> {
    const registry = await skillRegistryManager.forDomain(domainId);
    const enabledSkill = registry.resolveSkill(skillId, constraints);
    if (
      options.entry &&
      (enabledSkill.manifest.type !== SkillType.EXECUTABLE ||
        !enabledSkill.manifest.entries.includes(options.entry))
    ) {
      throw new Error(tApp("skills.exec.entryNotDeclared", { id: skillId, entry: options.entry }));
    }

    const startTime = Date.now();
    try {
      const result = await executeSkill(
        enabledSkill,
        input,
        {
          ...this.config,
          skillsRoot: skillRegistryManager.getDomainSkillsRoot(domainId),
        },
        options
      );
      this.recordSuccess(domainId, skillId, Date.now() - startTime);
      return result;
    } catch (error) {
      this.recordFailure(domainId, skillId, Date.now() - startTime);
      throw error;
    }
  }

  // ====== Metrics ======

  private ensureMetric(domainId: string, skillId: string): SkillExecutionMetrics {
    let metrics = this.metricsByDomain.get(domainId);
    if (!metrics) {
      metrics = new Map();
      this.metricsByDomain.set(domainId, metrics);
    }
    if (!metrics.has(skillId)) {
      metrics.set(skillId, {
        skillId,
        totalExecutions: 0,
        totalFailures: 0,
        totalSuccesses: 0,
        totalDurationMs: 0,
        lastExecutedAt: null,
      });
    }
    return metrics.get(skillId)!;
  }

  private recordSuccess(domainId: string, skillId: string, durationMs: number): void {
    const m = this.ensureMetric(domainId, skillId);
    m.totalExecutions++;
    m.totalSuccesses++;
    m.totalDurationMs += durationMs;
    m.lastExecutedAt = Date.now();
  }

  private recordFailure(domainId: string, skillId: string, durationMs: number): void {
    const m = this.ensureMetric(domainId, skillId);
    m.totalExecutions++;
    m.totalFailures++;
    m.totalDurationMs += durationMs;
    m.lastExecutedAt = Date.now();
  }

  getAllMetrics(domainId: string): SkillMetricsSnapshot {
    return {
      skills: Object.fromEntries(this.metricsByDomain.get(domainId) ?? []),
      updatedAt: Date.now(),
    };
  }
}

export const skillRuntime = new SkillRuntime();
