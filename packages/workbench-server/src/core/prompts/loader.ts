import { promptSources, runtimeDataDir, type ResourceCopy } from "../../content/layout";
import fs from "fs";
import path from "path";
import { createLogger } from "../../logging/logger";
import { getLanguageName, getOutputLanguageInstruction, tApp } from "../../i18n";

const logger = createLogger("prompt-loader");

type PromptDirectories = {
  sources: readonly ResourceCopy[];
  runtimeDir: string;
};

let testDirectories: PromptDirectories | null = null;
let syncedRuntimeDir: string | null = null;
let testNow: Date | null = null;

function getCurrentServerTime() {
  const now = testNow || new Date();
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const local = new Intl.DateTimeFormat("zh-CN", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(now);
  return {
    now,
    timeZone,
    iso: now.toISOString(),
    local,
    date: local.slice(0, 10).replaceAll("/", "-"),
    year: String(Number(local.slice(0, 4))),
  };
}

function buildTimeReferenceInstruction(current = getCurrentServerTime()) {
  return [
    tApp("foundation.time.header"),
    tApp("foundation.time.now", { value: current.local }),
    tApp("foundation.time.date", { value: current.date }),
    tApp("foundation.time.zone", { value: current.timeZone }),
    tApp("foundation.time.iso", { value: current.iso }),
    tApp("foundation.time.relativeRule"),
    tApp("foundation.time.yearRule"),
  ].join("\n");
}

function getPromptDirectories(): PromptDirectories {
  if (testDirectories) {
    return testDirectories;
  }
  return { sources: promptSources(), runtimeDir: runtimeDataDir("prompts") };
}

function ensureRuntimePrompts(): void {
  const { sources, runtimeDir } = getPromptDirectories();
  if (syncedRuntimeDir === runtimeDir) return;

  for (const { from, to } of sources) {
    const target = path.join(runtimeDir, to);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    // Node 24's native directory copy reports EACCES on macOS Docker Desktop bind mounts (frontend_data), not seen on Linux deployments; passing a filter forces the JS implementation. Removable once Node fixes the native implementation
    fs.cpSync(from, target, { recursive: true, force: true, errorOnExist: false, filter: () => true });
  }
  logger.info(tApp("foundation.log.prompts.synced"), { runtimeDir });

  syncedRuntimeDir = runtimeDir;
}

function keyToRelativePath(key: string): string {
  const segments = key.split(".");
  if (
    segments.some(
      (segment) => !segment || segment === ".." || segment.includes("/") || segment.includes("\\")
    )
  ) {
    throw new Error(`Invalid prompt key: ${key}`);
  }
  return path.join(...segments) + ".md";
}

function resolvePromptPath(key: string): string {
  const { runtimeDir } = getPromptDirectories();
  const promptPath = path.join(runtimeDir, keyToRelativePath(key));
  const dir = path.dirname(promptPath);
  const customPath = path.join(dir, `custom.${path.basename(promptPath)}`);
  return fs.existsSync(customPath) ? customPath : promptPath;
}

function loadFile(key: string): string {
  ensureRuntimePrompts();
  const filePath = resolvePromptPath(key);
  if (!fs.existsSync(filePath)) {
    const err = `Prompt file not found: ${filePath} (key: ${key})`;
    logger.error(err);
    throw new Error(err);
  }
  return fs.readFileSync(filePath, "utf-8");
}

export function renderPrompt(
  key: string,
  variables: Record<string, string> = {},
  locale?: string
): string {
  let template = loadFile(key);

  const currentServerTime = getCurrentServerTime();
  const serverTimeReference = buildTimeReferenceInstruction(currentServerTime);
  const langVars: Record<string, string> = {
    currentDate: currentServerTime.date,
    currentServerDate: currentServerTime.date,
    currentServerTime: currentServerTime.local,
    currentServerTimeISO: currentServerTime.iso,
    currentServerTimeZone: currentServerTime.timeZone,
    currentYear: currentServerTime.year,
    serverTimeReference,
    language: getLanguageName(locale),
    languageName: getLanguageName(locale),
    languageInstruction: getOutputLanguageInstruction(locale),
  };

  const allVars = { ...langVars, ...variables };
  for (const [name, value] of Object.entries(allVars)) {
    template = template.replaceAll(`{{${name}}}`, value);
  }

  template += `\n\n${serverTimeReference}\n\n${getOutputLanguageInstruction(locale)}`;

  return template.trim();
}

/** Protocol data `<key>.json` living next to a prompt and synced with it (e.g. evaluation output labels). */
export function loadPromptProtocol(key: string): unknown {
  ensureRuntimePrompts();
  const relativePath = keyToRelativePath(key).replace(/\.md$/, ".json");
  return JSON.parse(fs.readFileSync(path.join(getPromptDirectories().runtimeDir, relativePath), "utf-8"));
}

export function getPromptTemplate(key: string): string {
  return loadFile(key).trim();
}

/** Resolve a dot-separated directory inside the synchronized runtime prompt tree. */
export function resolvePromptDirectory(key: string): string {
  ensureRuntimePrompts();
  const segments = key.split(".");
  if (
    segments.some(
      (segment) => !segment || segment === ".." || segment.includes("/") || segment.includes("\\")
    )
  ) {
    throw new Error(`Invalid prompt directory key: ${key}`);
  }
  return path.join(getPromptDirectories().runtimeDir, ...segments);
}

export function syncDefaultPrompts(): void {
  syncedRuntimeDir = null;
  ensureRuntimePrompts();
}

export const __test__ = {
  getPromptDirectories,
  resolvePromptPath,
  syncDefaultPrompts,
  setPromptDirectories(directories: PromptDirectories | null) {
    testDirectories = directories;
    syncedRuntimeDir = null;
  },
  setNow(now: Date | null) {
    testNow = now;
  },
};
