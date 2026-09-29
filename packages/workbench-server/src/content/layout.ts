import path from "path";

/** One default resource: `from` is the read-only source (file or directory) and `to` the path relative to the target root. */
export interface ResourceCopy {
  from: string;
  to: string;
}

/**
 * Installed by the app before startup according to its own location. Read-only default resources each have an explicit source;
 * runtime data is written only beneath the product runtime root the app provides, and reads and sync targets use the same place.
 */
export interface ContentLayout {
  /** Product runtime root: runtime data under its data/, production web pages under its dist/web. */
  runtimeRoot: string;
  /** Default prompts, synced into data/prompts. */
  prompts: readonly ResourceCopy[];
  /** Skill templates, copied into data/domain-skills/<domain> when a new domain initializes. */
  skillTemplate: readonly ResourceCopy[];
  /** Default runtime resources, synced into echart, knowledge, and skills under data/. */
  runtimeResources: readonly ResourceCopy[];
}

let layout: ContentLayout | null = null;

export function installContentLayout(next: ContentLayout): void {
  layout = next;
}

function installedLayout(): ContentLayout {
  if (!layout) throw new Error("Workbench content layout is not installed");
  return layout;
}

export function runtimeRoot(): string {
  return installedLayout().runtimeRoot;
}

export function runtimeDataDir(...segments: string[]): string {
  return path.join(installedLayout().runtimeRoot, "data", ...segments);
}

export function webDistDir(): string {
  return path.join(installedLayout().runtimeRoot, "dist", "web");
}

export function promptSources(): readonly ResourceCopy[] {
  return installedLayout().prompts;
}

export function skillTemplateSources(): readonly ResourceCopy[] {
  return installedLayout().skillTemplate;
}

export function runtimeResourceSources(): readonly ResourceCopy[] {
  return installedLayout().runtimeResources;
}

export function echartDir(): string {
  return runtimeDataDir("echart");
}

export function knowledgeDir(): string {
  return runtimeDataDir("knowledge");
}

export function diagnosisSkillsDir(): string {
  return runtimeDataDir("skills");
}
