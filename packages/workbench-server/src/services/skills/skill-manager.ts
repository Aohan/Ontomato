import type { SkillOutput } from "@ontomato/contracts/skills";
import type { AnalysisAgentSkillReference } from "@ontomato/contracts/skills";
import type { SkillInfo, SkillDeleteResult } from "@ontomato/contracts/skills";
import fs from "fs";
import os from "os";
import path from "path";
import AdmZip from "adm-zip";
import { randomUUID } from "crypto";
import { skillRegistryManager } from "../../core/skills/registry/manager";
import type { SkillRegistryManager } from "../../core/skills/registry/manager";
import type { SkillMeta, SkillInput } from "../../core/skills/types";
import {
  assertSkillPackageComplete,
  InvalidSkillPackageError,
  migrateLegacySkillManifest,
  normalizeSkillPackagePath,
  type ParsedSkillMarkdown,
  readSkillMarkdown,
  SkillManifestSchema,
  writeSkillMarkdown,
} from "../../core/skills/manifest";
import type { SkillCategoryValue, SkillTypeValue } from "../../core/skills/constants";
import { SkillType } from "../../core/skills/constants";
import { createLogger } from "../../logging/logger";
import { tApp } from "../../i18n";
import { executeSkill } from "../../core/skills/execution/executor";
import {
  listAnalysisAgentSkillReferences,
  removeAnalysisAgentSkillReferences,
  restoreAnalysisAgentSkillReferences,
} from "../analysis-agent/config/skill-references";

const logger = createLogger("skill-manager");

const defaultSkillMdContent = tApp("skills.mgr.mdTemplate");

class SkillAlreadyExistsError extends Error {
  readonly code = "SKILL_EXISTS";

  constructor(readonly skillId: string) {
    super(tApp("skills.mgr.existsAsk", { id: skillId }));
    this.name = "SkillAlreadyExistsError";
  }
}

class SkillManager {
  async getAllSkills(domainId: string): Promise<SkillInfo[]> {
    const registry = await skillRegistryManager.forDomain(domainId);

    return registry
      .getSkills({ includeDisabled: true })
      .map((skill) => this.toSkillInfo(skill, registry));
  }

  private toSkillInfo(skill: SkillMeta, registry: SkillRegistryManager): SkillInfo {
    return {
      id: skill.id,
      type: skill.manifest.type,
      category: skill.manifest.category,
      title: skill.manifest.title,
      description: skill.manifest.description,
      tags: skill.manifest.tags,
      enabled: registry.isSkillEnabled(skill.id),
      path: skill.path,
      version: skill.manifest.version,
      outputType: skill.manifest.outputType,
      useCases: skill.manifest.useCases,
    };
  }

  async toggleSkill(domainId: string, skillId: string): Promise<{ enabled: boolean }> {
    const registry = await skillRegistryManager.forDomain(domainId);

    const skill = registry.getSkillById(skillId);
    if (!skill) {
      throw new Error(tApp("skills.mgr.skillNotFound", { id: skillId }));
    }

    const enabled = !registry.isSkillEnabled(skillId);
    registry.setSkillEnabled(skillId, enabled);
    logger.info(
      tApp(enabled ? "skills.mgr.toggleEnabled" : "skills.mgr.toggleDisabled", { id: skillId })
    );

    return { enabled };
  }

  async getSkillReferences(
    domainId: string,
    skillId: string
  ): Promise<AnalysisAgentSkillReference[]> {
    const registry = await skillRegistryManager.forDomain(domainId);
    if (!registry.getSkillById(skillId)) {
      throw new Error(tApp("skills.mgr.skillNotFound", { id: skillId }));
    }
    return listAnalysisAgentSkillReferences(domainId, skillId);
  }

  async deleteSkill(domainId: string, skillId: string): Promise<SkillDeleteResult> {
    const registry = await skillRegistryManager.forDomain(domainId);

    const skill = registry.getSkillById(skillId);
    if (!skill) {
      throw new Error(tApp("skills.mgr.skillNotFound", { id: skillId }));
    }

    const affectedAgents = await listAnalysisAgentSkillReferences(domainId, skillId);
    const wasEnabled = registry.isSkillEnabled(skillId);
    const trashRoot = path.join(skillRegistryManager.getDomainSkillsRoot(domainId), ".trash");
    const stagedPath = path.join(trashRoot, `${skillId}-${randomUUID()}`);
    let referencesRemoved = false;

    try {
      fs.mkdirSync(trashRoot, { recursive: true });
      fs.renameSync(skill.path, stagedPath);

      const cleanedAgentCount = await removeAnalysisAgentSkillReferences(domainId, skillId);
      referencesRemoved = true;
      registry.removeSkillState(skillId);
      registry.clearCache();
      await registry.initialize();

      try {
        fs.rmSync(stagedPath, { recursive: true, force: true });
      } catch (cleanupError) {
        logger.warn(tApp("skills.mgr.deleteCleanupWarn", { id: skillId }), cleanupError);
      }

      logger.info(
        tApp("skills.mgr.deletedInfo", { id: skillId, n: cleanedAgentCount })
      );
      return { affectedAgents, cleanedAgentCount };
    } catch (error) {
      if (referencesRemoved) {
        await restoreAnalysisAgentSkillReferences(domainId, skillId, affectedAgents).catch(
          (restoreError) => {
            logger.error(tApp("skills.mgr.restoreRefsFail", { id: skillId }), restoreError);
          }
        );
      }
      if (!wasEnabled) {
        registry.setSkillEnabled(skillId, false);
      }
      if (fs.existsSync(stagedPath) && !fs.existsSync(skill.path)) {
        fs.renameSync(stagedPath, skill.path);
      }
      registry.clearCache();
      await registry.initialize().catch((restoreError) => {
        logger.error(tApp("skills.mgr.restoreRegistryFail", { id: skillId }), restoreError);
      });

      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(tApp("skills.mgr.deleteFailLog", { id: skillId }), errorMessage);
      throw new Error(tApp("skills.mgr.deleteFail", { error: errorMessage }), { cause: error });
    }
  }

  async createSkill(
    domainId: string,
    skillId: string,
    type: SkillTypeValue,
    category: SkillCategoryValue,
    options: {
      title?: string;
      description?: string;
      tags?: string[];
      version?: string;
      timeout?: number;
      outputType?: "html" | "json" | "text";
      scriptCode?: string;
      skillContent?: string;
    }
  ): Promise<SkillInfo> {
    const registry = await skillRegistryManager.forDomain(domainId);

    const existing = registry.getSkillById(skillId);
    if (existing) {
      throw new Error(tApp("skills.mgr.alreadyExists", { id: skillId }));
    }

    const skillDir = path.join(
      skillRegistryManager.getDomainSkillsRoot(domainId),
      type,
      category,
      skillId
    );

    if (fs.existsSync(skillDir)) {
      throw new Error(tApp("skills.mgr.dirExists", { dir: skillDir }));
    }

    try {
      fs.mkdirSync(skillDir, { recursive: true });

      const manifest = SkillManifestSchema.parse({
        name: skillId,
        description: options.description?.trim() || options.title?.trim() || skillId,
        type,
        category,
        title: options.title || skillId,
        tags: options.tags || [],
        version: options.version || "1.0.0",
        timeout: options.timeout,
        outputType:
          type === SkillType.EXECUTABLE ? options.outputType || "html" : options.outputType,
        entries: type === SkillType.EXECUTABLE ? ["scripts/index.mjs"] : undefined,
      });

      if (type === SkillType.EXECUTABLE) {
        const scriptsDir = path.join(skillDir, "scripts");
        fs.mkdirSync(scriptsDir, { recursive: true });

        const defaultScript =
          options.scriptCode ||
          `export async function execute(input) {
  return {
    html: "<div>Skill ${skillId} executed</div>",
    meta: { skillId: "${skillId}" }
  };
}`;

        fs.writeFileSync(path.join(scriptsDir, "index.mjs"), defaultScript);
      }

      const skillMdContent = options.skillContent || defaultSkillMdContent;
      assertSkillPackageComplete(
        manifest,
        (relativePath) => fs.existsSync(path.join(skillDir, relativePath)),
        skillMdContent
      );
      writeSkillMarkdown(path.join(skillDir, "SKILL.md"), manifest, skillMdContent);

      logger.info(tApp("skills.mgr.createdInfo", { id: skillId, dir: skillDir }));

      registry.clearCache();
      await registry.initialize();

      const newSkill = registry.getSkillById(skillId);
      if (!newSkill) {
        throw new Error(tApp("skills.mgr.createNotFound"));
      }

      return this.toSkillInfo(newSkill, registry);
    } catch (error) {
      logger.error(tApp("skills.mgr.createFailLog", { id: skillId }), error);
      if (fs.existsSync(skillDir)) {
        fs.rmSync(skillDir, { recursive: true, force: true });
      }
      throw error;
    }
  }

  async updateSkill(
    domainId: string,
    skillId: string,
    options: {
      title?: string;
      description?: string;
      tags?: string[];
      version?: string;
      timeout?: number;
      outputType?: "html" | "json" | "text";
      scriptCode?: string;
      skillContent?: string;
    }
  ): Promise<SkillInfo> {
    const registry = await skillRegistryManager.forDomain(domainId);

    const skill = registry.getSkillById(skillId);
    if (!skill) {
      throw new Error(tApp("skills.mgr.skillNotFound", { id: skillId }));
    }

    const skillDir = skill.path;

    try {
      const skillMdPath = path.join(skillDir, "SKILL.md");
      const current = readSkillMarkdown(skillMdPath);
      if (!current) {
        throw new InvalidSkillPackageError(tApp("skills.mgr.frontmatterInvalid"));
      }

      const updatedManifest = SkillManifestSchema.parse({
        ...current.manifest,
        title: options.title ?? current.manifest.title,
        description: options.description ?? current.manifest.description,
        tags: options.tags ?? current.manifest.tags,
        version: options.version ?? current.manifest.version,
        timeout: options.timeout ?? current.manifest.timeout,
        outputType: options.outputType ?? current.manifest.outputType,
      });
      const updatedContent = options.skillContent ?? current.content;
      assertSkillPackageComplete(
        updatedManifest,
        (relativePath) => fs.existsSync(path.join(skillDir, relativePath)),
        updatedContent
      );

      if (skill.manifest.type === SkillType.EXECUTABLE && options.scriptCode) {
        const scriptPath = path.join(skillDir, skill.manifest.entry!);
        fs.writeFileSync(scriptPath, options.scriptCode);
      }

      writeSkillMarkdown(skillMdPath, updatedManifest, updatedContent);

      logger.info(tApp("skills.mgr.updatedInfo", { id: skillId }));

      registry.clearCache();
      await registry.initialize();

      const updatedSkill = registry.getSkillById(skillId);
      if (!updatedSkill) {
        throw new Error(tApp("skills.mgr.updateNotFound"));
      }

      return this.toSkillInfo(updatedSkill, registry);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(tApp("skills.mgr.updateFailLog", { id: skillId }), errorMessage);
      throw new Error(tApp("skills.mgr.updateFail", { error: errorMessage }), { cause: error });
    }
  }

  async getSkillScript(domainId: string, skillId: string): Promise<string | null> {
    const registry = await skillRegistryManager.forDomain(domainId);

    const skill = registry.getSkillById(skillId);
    if (!skill) {
      throw new Error(tApp("skills.mgr.skillNotFound", { id: skillId }));
    }

    if (skill.manifest.type !== SkillType.EXECUTABLE) {
      return null;
    }

    const scriptPath = path.join(skill.path, skill.manifest.entry!);
    if (!fs.existsSync(scriptPath)) {
      return null;
    }

    try {
      return fs.readFileSync(scriptPath, "utf-8");
    } catch (error) {
      logger.error(tApp("skills.mgr.scriptReadFail", { id: skillId }), error);
      return null;
    }
  }

  async getSkillContent(domainId: string, skillId: string): Promise<string | null> {
    const registry = await skillRegistryManager.forDomain(domainId);

    const skill = registry.getSkillById(skillId);
    if (!skill) {
      throw new Error(tApp("skills.mgr.skillNotFound", { id: skillId }));
    }

    const skillMdPath = path.join(skill.path, "SKILL.md");
    if (!fs.existsSync(skillMdPath)) {
      return null;
    }

    try {
      return readSkillMarkdown(skillMdPath)?.content ?? null;
    } catch (error) {
      logger.error(tApp("skills.mgr.contentReadFail", { id: skillId }), error);
      return null;
    }
  }

  async searchSkills(domainId: string, query: string): Promise<SkillInfo[]> {
    const registry = await skillRegistryManager.forDomain(domainId);
    if (!query || query.trim() === "") {
      return [];
    }

    return registry.searchSkills(query).map((skill) => this.toSkillInfo(skill, registry));
  }

  async importSkill(domainId: string, zipBuffer: Buffer, overwrite = false): Promise<SkillInfo> {
    let zip: AdmZip;
    try {
      zip = new AdmZip(zipBuffer);
    } catch (error) {
      throw new InvalidSkillPackageError(
        tApp("skills.mgr.zipUnreadable", {
          error: error instanceof Error ? error.message : String(error),
        })
      );
    }
    const zipEntries = zip.getEntries();
    const extractedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "workbench-skill-import-"));
    try {
      const candidateDirectories = new Set<string>();
      for (const entry of zipEntries) {
        if (entry.isDirectory) continue;
        const relativePath = normalizeSkillPackagePath(entry.entryName);
        if (!relativePath) {
          throw new InvalidSkillPackageError(
            tApp("skills.mgr.zipBadPath", { name: entry.entryName })
          );
        }
        const targetPath = path.join(extractedRoot, relativePath);
        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        fs.writeFileSync(targetPath, entry.getData());
        candidateDirectories.add(path.dirname(targetPath));
      }

      let packageRoot: string | null = null;
      let parsedPackage: ParsedSkillMarkdown | null = null;
      let frontmatterError: InvalidSkillPackageError | null = null;
      for (const candidateDirectory of candidateDirectories) {
        try {
          migrateLegacySkillManifest(candidateDirectory);
          const skillMdPath = path.join(candidateDirectory, "SKILL.md");
          if (!fs.existsSync(skillMdPath)) continue;
          const candidate = readSkillMarkdown(skillMdPath);
          if (candidate) {
            packageRoot = candidateDirectory;
            parsedPackage = candidate;
            break;
          }
        } catch (error) {
          if (!(error instanceof InvalidSkillPackageError)) throw error;
          frontmatterError ??= error;
        }
      }

      if (!packageRoot || !parsedPackage) {
        throw (
          frontmatterError ??
          new InvalidSkillPackageError(tApp("skills.mgr.noFrontmatter"))
        );
      }

      const { manifest, content } = parsedPackage;
      assertSkillPackageComplete(
        manifest,
        (relativePath) => {
          const requiredPath = path.join(packageRoot!, relativePath);
          return fs.existsSync(requiredPath) && fs.statSync(requiredPath).isFile();
        },
        content
      );

      const registry = await skillRegistryManager.forDomain(domainId);
      const domainSkillsRoot = skillRegistryManager.getDomainSkillsRoot(domainId);
      const existing = registry.getSkillById(manifest.name);
      const skillDir = path.join(domainSkillsRoot, manifest.type, manifest.category, manifest.name);

      if (existing && !overwrite) {
        throw new SkillAlreadyExistsError(manifest.name);
      }
      if (existing && existing.manifest.category !== manifest.category) {
        throw new Error(tApp("skills.mgr.categoryChange"));
      }
      if (!existing && fs.existsSync(skillDir)) {
        throw new InvalidSkillPackageError(
          tApp("skills.mgr.unregisteredDir", { dir: skillDir })
        );
      }

      const existingPath = existing?.path ?? null;
      const trashRoot = path.join(domainSkillsRoot, ".trash");
      const backupPath = existingPath
        ? path.join(trashRoot, `${manifest.name}-overwrite-${randomUUID()}`)
        : null;

      if (overwrite && existingPath) {
        if (existingPath !== skillDir && fs.existsSync(skillDir)) {
          throw new Error(tApp("skills.mgr.unsafeOverwrite", { dir: skillDir }));
        }
        fs.mkdirSync(trashRoot, { recursive: true });
        fs.renameSync(existingPath, backupPath!);
      }

      try {
        fs.mkdirSync(path.dirname(skillDir), { recursive: true });
        // Node 24's native directory copy reports EACCES on macOS Docker Desktop bind mounts (frontend_data), not seen on Linux deployments; passing a filter forces the JS implementation. Removable once Node fixes the native implementation
        fs.cpSync(packageRoot, skillDir, { recursive: true, errorOnExist: true, force: false, filter: () => true });
        logger.info(tApp("skills.mgr.importedInfo", { id: manifest.name, dir: skillDir }));

        registry.clearCache();
        await registry.initialize();

        const newSkill = registry.getSkillById(manifest.name);
        if (!newSkill) {
          throw new Error(
            tApp("skills.mgr.importNotFound", { id: manifest.name })
          );
        }

        if (backupPath && fs.existsSync(backupPath)) {
          fs.rmSync(backupPath, { recursive: true, force: true });
        }

        return this.toSkillInfo(newSkill, registry);
      } catch (error) {
        if (fs.existsSync(skillDir)) {
          fs.rmSync(skillDir, { recursive: true, force: true });
        }
        if (backupPath && existingPath && fs.existsSync(backupPath)) {
          fs.mkdirSync(path.dirname(existingPath), { recursive: true });
          fs.renameSync(backupPath, existingPath);
        }
        registry.clearCache();
        await registry.initialize().catch((restoreError) => {
          logger.error(
            tApp("skills.mgr.restoreOverwriteFail", { id: manifest.name }),
            restoreError
          );
        });
        throw error;
      }
    } finally {
      fs.rmSync(extractedRoot, { recursive: true, force: true });
    }
  }

  async debugSkill(domainId: string, skillId: string, input: SkillInput): Promise<SkillOutput> {
    const registry = await skillRegistryManager.forDomain(domainId);

    const skill = registry.resolveSkill(skillId, { type: SkillType.EXECUTABLE });

    if (!skill.manifest.entry) {
      throw new Error(tApp("skills.mgr.debugEntryUndefined", { id: skillId }));
    }

    try {
      const result = await executeSkill(skill, input, {
        skillsRoot: skillRegistryManager.getDomainSkillsRoot(domainId),
        timeout: skill.manifest.timeout || 30000,
        enableCache: false,
      });

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(tApp("skills.mgr.execFailed", { error: errorMessage }), { cause: error });
    }
  }

  async exportSkill(domainId: string, skillId: string): Promise<Buffer> {
    const registry = await skillRegistryManager.forDomain(domainId);

    const skill = registry.getSkillById(skillId);
    if (!skill) {
      throw new Error(tApp("skills.mgr.exportNotFound", { id: skillId }));
    }

    const skillDir = skill.path;
    if (!fs.existsSync(skillDir)) {
      throw new Error(tApp("skills.mgr.exportDirMissing", { dir: skillDir }));
    }

    const zip = new AdmZip();
    zip.addLocalFolder(skillDir);

    return zip.toBuffer();
  }
}

export const skillManager = new SkillManager();
