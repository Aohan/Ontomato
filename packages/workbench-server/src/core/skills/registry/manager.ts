import { runtimeDataDir, skillTemplateSources, type ResourceCopy } from "../../../content/layout";
import { SkillScanner } from "../discovery/scanner";
import { loadSkillContent } from "../discovery/loader";
import type { SkillMeta, RuntimeConfig, SkillMatch, SkillQuery } from "../types";
import type { SkillCategoryValue } from "../constants";
import { SkillStatesFile, SkillType } from "../constants";
import { createModel } from "../../../config/model-factory";
import { createLogger } from "../../../logging/logger";
import { renderPrompt } from "../../prompts/loader";
import { buildModelDataView } from "../../../utils/model-data-view";
import { tApp } from "../../../i18n";
import fs from "fs";
import path from "path";

const logger = createLogger("skill-registry-manager");

const defaultConfig: Omit<RuntimeConfig, "skillsRoot"> = {
  timeout: 5000,
  enableCache: true,
};

interface SkillStates {
  disabledSkills: string[];
  lastUpdated: string;
}

export type SkillResolutionErrorCode =
  | "SKILL_NOT_FOUND"
  | "SKILL_DISABLED"
  | "SKILL_CATEGORY_MISMATCH"
  | "SKILL_TYPE_MISMATCH"
  | "SKILL_NOT_SELECTED";

export class SkillResolutionError extends Error {
  constructor(
    readonly code: SkillResolutionErrorCode,
    readonly skillId: string,
    message: string
  ) {
    super(message);
    this.name = "SkillResolutionError";
  }
}

export class SkillRegistryManager {
  private scanner: SkillScanner;
  private skills: SkillMeta[] | null = null;
  private initialized: boolean = false;
  private disabledSkillIds: Set<string> = new Set();
  private statesWatcherCleanup: (() => void) | null = null;
  private readonly skillStatesPath: string;

  constructor(config: RuntimeConfig) {
    this.scanner = new SkillScanner(config);
    this.skillStatesPath = path.join(config.skillsRoot, SkillStatesFile);
    this.loadDisabledSkills();
    this.watchSkillStates();
  }

  private loadDisabledSkills(): void {
    try {
      if (fs.existsSync(this.skillStatesPath)) {
        const content = fs.readFileSync(this.skillStatesPath, "utf-8");
        const states: SkillStates = JSON.parse(content);
        this.disabledSkillIds = new Set(states.disabledSkills ?? []);
        logger.debug(`Loaded disabled skills: ${this.disabledSkillIds.size}`);
      }
    } catch {
      this.disabledSkillIds = new Set();
    }
  }

  private watchSkillStates(): void {
    try {
      if (!fs.existsSync(this.skillStatesPath)) return;

      const listener: fs.StatsListener = (curr, prev) => {
        if (curr.mtimeMs !== prev.mtimeMs) {
          logger.info("skill-states.json changed, reloading...");
          this.loadDisabledSkills();
        }
      };

      fs.watchFile(this.skillStatesPath, { interval: 1000 }, listener);
      this.statesWatcherCleanup = () => {
        fs.unwatchFile(this.skillStatesPath, listener);
      };
    } catch {
      logger.warn("Failed to set up file watcher for skill-states.json");
    }
  }

  private unwatchSkillStates(): void {
    this.statesWatcherCleanup?.();
    this.statesWatcherCleanup = null;
  }

  private initializing: boolean = false;
  private initPromise: Promise<void> | null = null;

  async initialize(): Promise<void> {
    if (this.initialized) return;

    if (this.initializing && this.initPromise) {
      await this.initPromise;
      return;
    }

    this.initializing = true;
    this.initPromise = this.doInitialize();

    try {
      await this.initPromise;
    } finally {
      this.initializing = false;
      this.initPromise = null;
    }
  }

  private async doInitialize(): Promise<void> {
    this.loadDisabledSkills();
    this.skills = await this.scanner.scan();
    this.initialized = true;
  }

  getSkills(query: SkillQuery = {}): SkillMeta[] {
    if (!this.skills) {
      throw new Error("SkillRegistryManager not initialized. Call initialize() first.");
    }
    const selectedIds =
      query.selectedSkillIds === undefined ? null : new Set(query.selectedSkillIds);

    return this.skills.filter((skill) => {
      if (query.type && skill.manifest.type !== query.type) return false;
      if (query.category && skill.manifest.category !== query.category) return false;
      if (selectedIds && !selectedIds.has(skill.id)) return false;
      if (!query.includeDisabled && !this.isSkillEnabled(skill.id)) return false;
      return true;
    });
  }

  isSkillEnabled(skillId: string): boolean {
    return !this.disabledSkillIds.has(skillId);
  }

  setSkillEnabled(skillId: string, enabled: boolean): void {
    if (enabled) {
      this.disabledSkillIds.delete(skillId);
    } else {
      this.disabledSkillIds.add(skillId);
    }
    this.saveDisabledSkills();
  }

  removeSkillState(skillId: string): void {
    if (this.disabledSkillIds.delete(skillId)) {
      this.saveDisabledSkills();
    }
  }

  private saveDisabledSkills(): void {
    const states: SkillStates = {
      disabledSkills: [...this.disabledSkillIds].sort(),
      lastUpdated: new Date().toISOString(),
    };
    fs.mkdirSync(path.dirname(this.skillStatesPath), { recursive: true });
    fs.writeFileSync(this.skillStatesPath, JSON.stringify(states, null, 2));
  }

  getSkillById(skillId: string): SkillMeta | null {
    return this.getSkills({ includeDisabled: true }).find((skill) => skill.id === skillId) ?? null;
  }

  resolveSkill(
    skillId: string,
    query: Pick<SkillQuery, "type" | "category" | "selectedSkillIds"> = {}
  ): SkillMeta {
    const skill = this.getSkillById(skillId);
    if (!skill) {
      throw new SkillResolutionError("SKILL_NOT_FOUND", skillId, tApp("skills.resolve.notFound", { id: skillId }));
    }
    if (query.type && skill.manifest.type !== query.type) {
      throw new SkillResolutionError(
        "SKILL_TYPE_MISMATCH",
        skillId,
        tApp("skills.resolve.typeMismatch", {
          id: skillId,
          actual: skill.manifest.type,
          expected: query.type,
        })
      );
    }
    if (query.category && skill.manifest.category !== query.category) {
      throw new SkillResolutionError(
        "SKILL_CATEGORY_MISMATCH",
        skillId,
        tApp("skills.resolve.categoryMismatch", {
          id: skillId,
          actual: skill.manifest.category,
          expected: query.category,
        })
      );
    }
    if (query.selectedSkillIds && !query.selectedSkillIds.includes(skillId)) {
      throw new SkillResolutionError(
        "SKILL_NOT_SELECTED",
        skillId,
        tApp("skills.resolve.notSelected", { id: skillId })
      );
    }
    if (!this.isSkillEnabled(skillId)) {
      throw new SkillResolutionError("SKILL_DISABLED", skillId, tApp("skills.resolve.disabled", { id: skillId }));
    }
    return skill;
  }

  async matchKnowledgeSkillsWithLLM(
    query: string,
    category?: SkillCategoryValue,
    data?: Record<string, unknown>[],
    onEvent?: (event: { type: string; content: string }) => void
  ): Promise<SkillMatch[]> {
    const skills = this.getSkills({ type: SkillType.KNOWLEDGE, category });

    if (skills.length === 0) {
      onEvent?.({ type: "thinking", content: tApp("skills.thinking.noKnowledge") });
      return [];
    }

    const skillsInfo = skills
      .map((skill, index) => {
        return `${index + 1}. ID: ${skill.id}${tApp("skills.prompt.infoTitle", {
          value: skill.manifest.title || tApp("skills.prompt.promptNone"),
        })}${tApp("skills.prompt.infoCategory", {
          value: skill.manifest.category || tApp("skills.prompt.promptNone"),
        })}${tApp("skills.prompt.infoTags", {
          value: skill.manifest.tags?.join(", ") || tApp("skills.prompt.promptNone"),
        })}${tApp("skills.prompt.infoDesc", {
          value: skill.manifest.description || tApp("skills.prompt.promptNoDesc"),
        })}`;
      })
      .join("\n\n");

    let dataInfo = "";
    if (data && data.length > 0) {
      const rowCount = data.length;
      const fields = Array.from(new Set(data.flatMap((row) => Object.keys(row || {}))));
      const dataView = buildModelDataView(data);
      const visibleRows = [...dataView.headRows, ...dataView.tailRows];
      const fieldsTypeInfo = fields
        .map((field) => {
          const sample = visibleRows.map((row) => row[field]);
          const types = sample.filter((v) => v !== null && v !== undefined).map((v) => typeof v);
          const typeStr = types.length > 0 ? types[0] : "unknown";
          return `${field}(${typeStr})`;
        })
        .join(", ");
      dataInfo = `${tApp("skills.prompt.dataRows", { n: rowCount })}${tApp("skills.prompt.dataFields", { f: fieldsTypeInfo })}`;
    }

    const prompt = renderPrompt("skills.executor.knowledge.user", { query, dataInfo, skillsInfo });

    try {
      const model = await createModel({ temperature: 0.3, agentName: "Skill-Executor" });

      onEvent?.({ type: "thinking", content: tApp("skills.thinking.analyzing") });

      let fullContent = "";
      const stream = await model.stream([{ role: "user", content: prompt }]);

      for await (const chunk of stream) {
        const token = chunk.content;
        if (token) {
          fullContent += token;
        }
      }

      logger.info(tApp("skills.match.llmContent", { content: fullContent }));
      const jsonMatch = fullContent.match(/\{[\s\S]*"selectedSkills"[\s\S]*\}/);

      if (!jsonMatch) {
        onEvent?.({ type: "thinking", content: tApp("skills.thinking.noValidJson") });
        return [];
      }

      const result = JSON.parse(jsonMatch[0]);
      const selectedSkillIds = result.selectedSkills || [];

      const matches: SkillMatch[] = [];
      for (const skillId of selectedSkillIds) {
        const skill = skills.find((s) => s.id === skillId);
        if (skill) {
          matches.push({
            skill,
            confidence: result.confidence || 0.8,
            reason: result.reason || "LLM selected",
          });
        }
      }

      if (matches.length > 0) {
        onEvent?.({
          type: "thinking",
          content: tApp("skills.thinking.matched", {
            names: matches.map((m) => m.skill.manifest.title || m.skill.id).join(", "),
          }),
        });
      }

      return matches;
    } catch (error) {
      logger.warn("LLM skill matching failed:", error);
      onEvent?.({ type: "thinking", content: tApp("skills.thinking.matchFailed") });
      return [];
    }
  }

  searchSkills(query: string): SkillMeta[] {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return [];
    return this.getSkills({ includeDisabled: true }).filter((skill) => {
      const manifest = skill.manifest;
      return (
        skill.id.toLowerCase().includes(normalized) ||
        manifest.title?.toLowerCase().includes(normalized) ||
        manifest.description?.toLowerCase().includes(normalized) ||
        manifest.tags.some((tag) => tag.toLowerCase().includes(normalized))
      );
    });
  }

  getSkillsForAgentContext(category: SkillCategoryValue): string {
    const skills = this.getSkills({ category });
    const knowledgeSkills = skills.filter((skill) => skill.manifest.type === SkillType.KNOWLEDGE);
    const executableSkills = skills.filter((skill) => skill.manifest.type === SkillType.EXECUTABLE);

    let context = tApp("skills.prompt.ctxHeader", { category });

    if (knowledgeSkills.length > 0) {
      context += tApp("skills.prompt.knowHeader");
      for (const skill of knowledgeSkills) {
        const content = loadSkillContent(skill);
        if (content) {
          context += `\n**${skill.manifest.title || skill.id}**\n${content}\n`;
        }
      }
    }

    if (executableSkills.length > 0) {
      context += tApp("skills.prompt.execHeader");
      for (const skill of executableSkills) {
        context += `- **${skill.manifest.title || skill.id}**: ${skill.manifest.description || tApp("skills.prompt.promptNoDesc")}\n`;
        if (skill.manifest.useCases) {
          context += `${tApp("skills.prompt.useCases", { cases: skill.manifest.useCases.join(", ") })}\n`;
        }
      }
    }

    return context;
  }

  clearCache(): void {
    this.scanner.clearCache();
    this.initialized = false;
    this.skills = null;
    this.initializing = false;
    this.initPromise = null;
  }

  dispose(): void {
    this.unwatchSkillStates();
  }
}

export class DomainSkillRegistryManager {
  private readonly registries = new Map<string, SkillRegistryManager>();
  private readonly initializationFlights = new Map<string, Promise<string>>();

  constructor(
    private readonly templateSources: readonly ResourceCopy[] = skillTemplateSources(),
    private readonly domainsRoot = runtimeDataDir("domain-skills")
  ) {}

  getDomainSkillsRoot(domainId: string): string {
    const normalizedDomainId = domainId.trim();
    if (!normalizedDomainId) {
      throw new Error("domainId is required");
    }
    const directoryName = encodeURIComponent(normalizedDomainId).replace(/\./g, "%2E");
    return path.join(this.domainsRoot, directoryName);
  }

  async ensureDomainSkills(domainId: string): Promise<string> {
    const existingFlight = this.initializationFlights.get(domainId);
    if (existingFlight) return existingFlight;

    const initialization = this.copyTemplateIfMissing(domainId);
    this.initializationFlights.set(domainId, initialization);
    try {
      return await initialization;
    } finally {
      if (this.initializationFlights.get(domainId) === initialization) {
        this.initializationFlights.delete(domainId);
      }
    }
  }

  async forDomain(domainId: string): Promise<SkillRegistryManager> {
    const skillsRoot = await this.ensureDomainSkills(domainId);
    let registry = this.registries.get(domainId);
    if (!registry) {
      registry = new SkillRegistryManager({ ...defaultConfig, skillsRoot });
      this.registries.set(domainId, registry);
    }
    await registry.initialize();
    return registry;
  }

  dispose(): void {
    for (const registry of this.registries.values()) {
      registry.dispose();
    }
    this.registries.clear();
  }

  private async copyTemplateIfMissing(domainId: string): Promise<string> {
    const skillsRoot = this.getDomainSkillsRoot(domainId);
    if (fs.existsSync(skillsRoot)) return skillsRoot;

    try {
      await fs.promises.mkdir(this.domainsRoot, { recursive: true });
      for (const { from, to } of this.templateSources) {
        await fs.promises.cp(from, path.join(skillsRoot, to), {
          recursive: true,
          errorOnExist: true,
          force: false,
        });
      }
      logger.info("Initialized domain skills from template", { domainId, skillsRoot });
      return skillsRoot;
    } catch (error) {
      await fs.promises.rm(skillsRoot, { recursive: true, force: true });
      throw error;
    }
  }
}

export const skillRegistryManager = new DomainSkillRegistryManager();
