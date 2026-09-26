import path from "path";

/** 一条默认资源：from 是只读来源（文件或目录），to 是相对目标根的路径。 */
export interface ResourceCopy {
  from: string;
  to: string;
}

/**
 * 应用在启动前按自身位置安装。只读默认资源各有明确来源；
 * 运行数据只写在应用给出的产品运行根下，读取与同步目标同为该处。
 */
export interface ContentLayout {
  /** 产品运行根：运行数据在其 data/，生产网页在其 dist/web。 */
  runtimeRoot: string;
  /** 默认提示词，同步到 data/prompts。 */
  prompts: readonly ResourceCopy[];
  /** 技能模板，新域初始化时复制到 data/domain-skills/<域>。 */
  skillTemplate: readonly ResourceCopy[];
  /** 默认运行资源，同步到 data/ 下的 echart、knowledge、skills。 */
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
