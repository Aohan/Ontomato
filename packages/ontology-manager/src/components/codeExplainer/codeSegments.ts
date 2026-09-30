/*
 * Action code explanation: segment tree types, boundary normalization and pure logic.
 *
 * codeSegments come from an LLM and are an external boundary. This module is the only place that normalizes unknown
 * into a typed segment tree; after normalization the components trust these types and do not probe again.
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
 * The 13 kinds are listed only here: the SegmentKind discriminant, colour variables and localized message keys
 * all derive from it. Entry validation guarantees the kind is one of them, so there is no "unknown kind" afterwards.
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

/** The six kinds with expandable details (other kinds render only the card and nested child segments). */
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
  // A missing child array counts as empty; once present it must be an array ("if present, must be an array"), and null is not allowed.
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
  // The backend ActionCodeExplanationValidator guarantees the shape of detail fields (present means valid),
  // so they are only typed here, not normalized one by one.
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
 * The only boundary entry: normalizes the codeSegments (unknown) returned by `queryById` into a segment tree.
 * Only the entry levels are validated: a non-empty array; each segment's kind is one of the 13, id/title are strings,
 * codeRange is two numbers, and child arrays are well-formed. Any invalid part (including an empty array) fails the
 * whole tree and the caller shows "invalid explanation data" instead of silently treating it as empty.
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

/** Shape check for business meaning: an object whose operations is a string array and negativeEffect a string; otherwise null. */
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

/** Pre-order flattening of the segment tree (including all nested children), used for counting and line lookup. */
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

/** Finds the innermost segment containing the line (smallest line range); returns null if none does (the caller does nothing). */
export function findInnermostSegment(flat: FlatSegment[], line: number): CodeSegment | null {
  let best: FlatSegment | null = null;
  for (const item of flat) {
    if (item.start <= line && line <= item.end) {
      if (!best || item.end - item.start < best.end - best.start) best = item;
    }
  }
  return best ? best.seg : null;
}

/** Kinds that actually occur in this action (in order of first occurrence), used for the right-panel legend. */
export function collectKinds(segments: CodeSegment[]): SegmentKind[] {
  const kinds: SegmentKind[] = [];
  for (const item of flattenSegments(segments)) {
    if (!kinds.includes(item.seg.kind)) kinds.push(item.seg.kind);
  }
  return kinds;
}

/** Short name from a full class path: `/univ_demo/org` → `org` (output fields display as `classShortName.attribute`). */
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
 * Tokenizes output field expressions: aggregate functions, distinct and arithmetic operators are coloured separately;
 * plain identifiers display as `classShortName.attribute` (the caller resolves the short name from the source alias).
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

/** Display text for a condition leaf value (Parameter names, arrays and objects are expanded as-is). */
export function formatConditionValue(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return `[${value.map(formatConditionValue).join(", ")}]`;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
