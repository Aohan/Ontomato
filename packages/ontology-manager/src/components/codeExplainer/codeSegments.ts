/*
 * 动作代码解读：段树类型、边界规范化与纯逻辑。
 *
 * codeSegments 出自 LLM，是外部边界。本模块是唯一把 unknown 规范化成
 * 有类型段树的地方；规范化之后的组件内部直接信任这些类型，不再探测。
 */

import type { MessageKey } from "../../i18n";

export interface CodeRange {
  start: number;
  end: number;
}

export interface ConditionLeaf {
  field: string;
  operator: string;
  value: unknown;
}

export interface ConditionLogicGroup {
  operator: "logic";
  and?: ConditionNode[];
  or?: ConditionNode[];
}

export interface ConditionProperties {
  properties: ConditionNode;
}

export type ConditionNode = ConditionLeaf | ConditionLogicGroup | ConditionProperties;

export interface QueryObjectFilter {
  alias: string;
  class: string;
  conditions?: ConditionNode;
}

export interface RelationRef {
  from: string;
  to: string;
  type: string;
}

export interface QueryFilters {
  objects: QueryObjectFilter[];
  relationship?: RelationRef[];
}

export interface OutputField {
  source: string;
  field: string;
}

export interface SortField {
  source: string;
  field: string;
  order: string;
}

export interface PageLimit {
  offset?: number;
  count?: number;
}

export interface QueryOutput {
  fields?: OutputField[];
  group_by?: OutputField[];
  sort?: SortField[];
  limit?: PageLimit;
}

export interface Assignment {
  field: string;
  valueFrom: string;
}

export interface CatchClause {
  error: string;
  segs: CodeSegment[];
}

export interface BranchArm {
  condition: string;
  segs: CodeSegment[];
}

export interface CodeSegment {
  id: string;
  kind: SegmentKind;
  title: string;
  narrative?: string;
  codeRange: CodeRange;
  trySegs: CodeSegment[];
  catchs: CatchClause[];
  segs: CodeSegment[];
  branchArms: BranchArm[];
  filters?: QueryFilters;
  output?: QueryOutput;
  class?: string;
  assignments?: Assignment[];
  conditions?: ConditionNode;
  estRows?: string | number;
  relation?: string;
  sourceClass?: string;
  sourceObjectIdFrom?: string;
  targetClass?: string;
  targetObjectIdFrom?: string;
}

export type NormalizeResult = { ok: true; segments: CodeSegment[] } | { ok: false };

/*
 * 13 种 kind 只在这里列出一次：SegmentKind 判别字段、颜色变量、
 * 本地化文案 key 都从它派生。入口校验保证 kind 属于其中之一，
 * 之后不再有“未知 kind”。
 */
export const KIND_TEXT_KEYS = {
  QUERY: "kindQuery",
  CREATE_OBJECT: "kindCreateObject",
  UPDATE_OBJECT: "kindUpdateObject",
  DELETE_OBJECT: "kindDeleteObject",
  CREATE_EDGE: "kindCreateEdge",
  DELETE_EDGE: "kindDeleteEdge",
  COMPUTE: "kindCompute",
  EXTERNAL_CALL: "kindExternalCall",
  BRANCH: "kindBranch",
  LOOP: "kindLoop",
  TRY_CATCH: "kindTryCatch",
  ERROR_HANDLING: "kindErrorHandling",
  CUSTOM: "kindCustom",
} as const satisfies Record<string, MessageKey>;

export type SegmentKind = keyof typeof KIND_TEXT_KEYS;

export function kindColorVar(kind: SegmentKind): string {
  return `var(--seg-${kind})`;
}

export function kindTextKey(kind: SegmentKind): MessageKey {
  return KIND_TEXT_KEYS[kind];
}

/** 六种可展开详情的 kind（其余 kind 只渲染卡片与嵌套子段）。 */
export const EXPANDABLE_KINDS = new Set<SegmentKind>([
  "QUERY",
  "CREATE_OBJECT",
  "UPDATE_OBJECT",
  "DELETE_OBJECT",
  "CREATE_EDGE",
  "DELETE_EDGE",
]);

export function isExpandableKind(kind: SegmentKind): boolean {
  return EXPANDABLE_KINDS.has(kind);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toText(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function normalizeChildSegs(value: unknown): CodeSegment[] | undefined {
  // 子段数组缺席视为空；一旦出现就必须是数组（“若存在必须是数组”），null 也不行。
  if (value === undefined) return [];
  return normalizeSegments(value);
}

function normalizeRange(value: unknown): CodeRange | undefined {
  if (!isRecord(value)) return undefined;
  const start = value.start;
  const end = value.end;
  if (typeof start !== "number" || typeof end !== "number") return undefined;
  return { start, end };
}

function normalizeSegments(value: unknown): CodeSegment[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const segments: CodeSegment[] = [];
  for (const item of value) {
    const seg = normalizeSegment(item);
    if (!seg) return undefined;
    segments.push(seg);
  }
  return segments;
}

function normalizeCatchs(value: unknown): CatchClause[] | undefined {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return undefined;
  const result: CatchClause[] = [];
  for (const item of value) {
    if (!isRecord(item)) return undefined;
    const segs = normalizeChildSegs(item.segs);
    if (!segs) return undefined;
    result.push({ error: item.error as string, segs });
  }
  return result;
}

function normalizeBranchArms(value: unknown): BranchArm[] | undefined {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return undefined;
  const result: BranchArm[] = [];
  for (const item of value) {
    if (!isRecord(item)) return undefined;
    const segs = normalizeChildSegs(item.segs);
    if (!segs) return undefined;
    result.push({ condition: item.condition as string, segs });
  }
  return result;
}

function normalizeSegment(value: unknown): CodeSegment | undefined {
  if (!isRecord(value)) return undefined;
  const id = toText(value.id);
  const title = toText(value.title);
  const kind = value.kind;
  const codeRange = normalizeRange(value.codeRange);
  if (id === undefined || title === undefined || !codeRange) return undefined;
  if (typeof kind !== "string" || !(kind in KIND_TEXT_KEYS)) return undefined;
  const trySegs = normalizeChildSegs(value.trySegs);
  const segs = normalizeChildSegs(value.segs);
  const catchs = normalizeCatchs(value.catchs);
  const branchArms = normalizeBranchArms(value.branchArms);
  if (!trySegs || !segs || !catchs || !branchArms) return undefined;
  // 详情字段的形状由后端 ActionCodeExplanationValidator 保证（出现即合格），
  // 这里只原样带入类型，不再逐个规范化。
  return {
    id,
    kind: kind as SegmentKind,
    title,
    narrative: value.narrative as string | undefined,
    codeRange,
    trySegs,
    catchs,
    segs,
    branchArms,
    filters: value.filters as QueryFilters | undefined,
    output: value.output as QueryOutput | undefined,
    class: value.class as string | undefined,
    assignments: value.assignments as Assignment[] | undefined,
    conditions: value.conditions as ConditionNode | undefined,
    estRows: value.estRows as string | number | undefined,
    relation: value.relation as string | undefined,
    sourceClass: value.sourceClass as string | undefined,
    sourceObjectIdFrom: value.sourceObjectIdFrom as string | undefined,
    targetClass: value.targetClass as string | undefined,
    targetObjectIdFrom: value.targetObjectIdFrom as string | undefined,
  };
}

/**
 * 边界唯一入口：把 `queryById` 返回的 codeSegments（unknown）规范化为段树。
 * 只校验入口层级：非空数组；每段 kind 属于 13 种、id/title 是字符串、
 * codeRange 两个数字、子段数组层级正确。有一处不合法（空数组也算）就整体判错，
 * 调用方显示“解读数据格式不正确”，不静默当成空。
 */
export function normalizeCodeSegments(value: unknown): NormalizeResult {
  const segments = normalizeSegments(value);
  if (!segments || segments.length === 0) return { ok: false };
  return { ok: true, segments };
}

export interface BusinessMeaning {
  operations: string[];
  negativeEffect: string;
}

/** 业务含义的形状检查：是对象、operations 是字符串数组、negativeEffect 是字符串；否则 null。 */
export function normalizeBusinessMeaning(value: unknown): BusinessMeaning | null {
  if (!isRecord(value)) return null;
  if (
    !Array.isArray(value.operations) ||
    !value.operations.every((item) => typeof item === "string")
  ) {
    return null;
  }
  if (typeof value.negativeEffect !== "string") return null;
  return {
    operations: value.operations as string[],
    negativeEffect: value.negativeEffect,
  };
}

export interface FlatSegment {
  seg: CodeSegment;
  start: number;
  end: number;
}

/** 先序展平段树（含全部嵌套子段），用于计数与行定位。 */
export function flattenSegments(segments: CodeSegment[]): FlatSegment[] {
  const result: FlatSegment[] = [];
  const visit = (seg: CodeSegment) => {
    result.push({ seg, start: seg.codeRange.start, end: seg.codeRange.end });
    for (const child of seg.trySegs) visit(child);
    for (const clause of seg.catchs) {
      for (const child of clause.segs) visit(child);
    }
    for (const child of seg.segs) visit(child);
    for (const arm of seg.branchArms) {
      for (const child of arm.segs) visit(child);
    }
  };
  for (const seg of segments) visit(seg);
  return result;
}

/** 找到包含该行的最内层段（行范围最小者）；都不包含返回 null（调用方无反应）。 */
export function findInnermostSegment(flat: FlatSegment[], line: number): CodeSegment | null {
  let best: FlatSegment | null = null;
  for (const item of flat) {
    if (item.start <= line && line <= item.end) {
      if (!best || item.end - item.start < best.end - best.start) best = item;
    }
  }
  return best ? best.seg : null;
}

/** 本动作实际出现的 kind（按首次出现顺序），用于右栏图例。 */
export function collectKinds(segments: CodeSegment[]): SegmentKind[] {
  const kinds: SegmentKind[] = [];
  for (const item of flattenSegments(segments)) {
    if (!kinds.includes(item.seg.kind)) kinds.push(item.seg.kind);
  }
  return kinds;
}

/** 类全路径取短名：`/univ_demo/org` → `org`（输出字段显示为 `类短名.属性`）。 */
export function simplifyClassName(cls: string): string {
  const parts = cls.split("/").filter((part) => part.length > 0);
  return parts.length > 0 ? parts[parts.length - 1] : cls;
}

function isWordStart(char: string): boolean {
  return /[A-Za-z_]/.test(char);
}

function isWordChar(char: string): boolean {
  return /[A-Za-z0-9_]/.test(char);
}

export type FieldTokenType = "attr" | "func" | "distinct" | "op" | "plain";

export interface FieldToken {
  type: FieldTokenType;
  text: string;
}

/**
 * 输出字段表达式分词：聚合函数、distinct、四则运算符各自着色，
 * 普通标识按 `类短名.属性` 显示（类短名由调用方按 source 别名查得）。
 */
export function tokenizeFieldExpr(expr: string, classShort: string): FieldToken[] {
  const tokens: FieldToken[] = [];
  let i = 0;
  const n = expr.length;
  const push = (type: FieldTokenType, text: string) => {
    const last = tokens[tokens.length - 1];
    if (type === "plain" && last && last.type === "plain") last.text += text;
    else tokens.push({ type, text });
  };
  while (i < n) {
    const char = expr[i];
    if (isWordStart(char)) {
      let j = i;
      while (j < n && isWordChar(expr[j])) j++;
      const word = expr.slice(i, j);
      let k = j;
      while (k < n && expr[k] === " ") k++;
      if (word === "distinct") push("distinct", word);
      else if (expr[k] === "(") push("func", word);
      else push("attr", classShort ? `${classShort}.${word}` : word);
      i = j;
      continue;
    }
    if (/[+\-*/]/.test(char)) {
      push("op", char);
      i++;
      continue;
    }
    push("plain", char);
    i++;
  }
  return tokens;
}

/** 条件叶子值转展示文本（Parameter 名、数组与对象照原样展开）。 */
export function formatConditionValue(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return `[${value.map(formatConditionValue).join(", ")}]`;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
