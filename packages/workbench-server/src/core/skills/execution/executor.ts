import type { SkillOutput } from "@ontomato/contracts/skills";
import path from "path";
import { pathToFileURL } from "url";
import type { SkillMeta, SkillInput, RuntimeConfig } from "../types";
import { createLogger } from "../../../logging/logger";
import { resolveSkillPackageFile } from "../discovery/loader";
import { tApp } from "../../../i18n";

const logger = createLogger("executor");

const defaultConfig: RuntimeConfig = {
  skillsRoot: path.join(process.cwd(), "skills"),
  timeout: 5000,
  enableCache: true,
  maxRetries: 0,
  retryDelayMs: 1000,
};

export interface SkillExecutionOptions {
  /** Entry already confirmed by the calling boundary to be inside the frontmatter entries */
  entry?: string;
  /** Per-call override; when absent, the existing semantics of the skill declaration and runtime configuration apply */
  maxRetries?: number;
  signal?: AbortSignal;
}

async function executeOnce(
  skill: SkillMeta,
  input: SkillInput,
  timeout: number,
  entry: string,
  signal?: AbortSignal
): Promise<SkillOutput> {
  signal?.throwIfAborted();
  const entryPath = await resolveSkillPackageFile(skill, entry);
  signal?.throwIfAborted();
  const entryUrl = pathToFileURL(entryPath);
  const skillModule = await import(`${entryUrl.href}?t=${Date.now()}`);
  signal?.throwIfAborted();

  if (!skillModule.execute || typeof skillModule.execute !== "function") {
    throw new Error(`Skill ${skill.id} does not export an execute function`);
  }

  const startTime = Date.now();

  let timer: ReturnType<typeof setTimeout> | undefined;
  let result: SkillOutput;
  try {
    result = await Promise.race([
      skillModule.execute(input),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Skill execution timeout after ${timeout}ms`)),
          timeout
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }

  const executionTime = Date.now() - startTime;

  return {
    html: result.html,
    json: result.json,
    text: result.text,
    meta: {
      executionTime,
      skillId: skill.id,
      retries: 0,
      ...result.meta,
    },
  };
}

export async function executeSkill(
  skill: SkillMeta,
  input: SkillInput,
  config: RuntimeConfig = defaultConfig,
  options: SkillExecutionOptions = {}
): Promise<SkillOutput> {
  options.signal?.throwIfAborted();
  const entry = options.entry ?? skill.manifest.entry;
  if (!entry) {
    throw new Error(`Skill ${skill.id} has no entry defined in manifest`);
  }
  if (skill.manifest.type !== "executable" || !skill.manifest.entries.includes(entry)) {
    throw new Error(tApp("skills.exec.entryNotDeclared", { id: skill.id, entry }));
  }

  const timeout = skill.manifest.timeout || config.timeout;
  const maxRetries = options.maxRetries ?? skill.manifest.retries ?? config.maxRetries ?? 0;
  const retryDelay = config.retryDelayMs ?? 1000;

  let processedInput = input;

  if (input.dataRef && input.context) {
    const refPath = input.dataRef.split(".");
    let refData: any = input.context;
    for (const key of refPath) {
      if (refData && typeof refData === "object" && key in refData) {
        refData = refData[key];
      } else {
        throw new Error(`Cannot resolve dataRef: ${input.dataRef}`);
      }
    }

    if (Array.isArray(refData)) {
      processedInput.data = refData;
    } else if (refData && typeof refData === "object") {
      processedInput.data = refData.previewRows || refData.data || [refData];
    } else {
      throw new Error(`Resolved dataRef is not valid data: ${input.dataRef}`);
    }
  }

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    options.signal?.throwIfAborted();
    try {
      const result = await executeOnce(skill, processedInput, timeout, entry, options.signal);
      options.signal?.throwIfAborted();
      if (attempt > 0 && result.meta) {
        result.meta.retries = attempt;
      }
      return result;
    } catch (e) {
      options.signal?.throwIfAborted();
      lastError = e instanceof Error ? e : new Error(String(e));
      if (attempt < maxRetries) {
        logger.warn(
          `Skill ${skill.id} attempt ${attempt + 1}/${maxRetries + 1} failed, retrying in ${retryDelay}ms: ${lastError.message}`
        );
        await new Promise((resolve) => setTimeout(resolve, retryDelay));
      }
    }
  }

  logger.error(`Skill ${skill.id} failed after ${maxRetries + 1} attempts: ${lastError!.message}`);
  throw lastError!;
}
