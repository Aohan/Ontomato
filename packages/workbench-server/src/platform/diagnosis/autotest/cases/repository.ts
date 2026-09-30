import type { CaseSet, CaseSetListItem, TestCase } from "@ontomato/contracts/autotest";
/**
 * CaseSet file-based repository.
 *
 * Stores each case set as a JSON file under
 * `{dataDir}/case-sets/{id}.json`.
 *
 * Supports importing from legacy ragchat-server JSON format.
 */

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createLogger } from "../../../../logging/logger";
import { autotestConfig } from "../config";

const logger = createLogger("autotest:cases");

function caseSetsDir(): string {
  return path.join(autotestConfig.dataDir, "case-sets");
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/** Validate id to prevent path traversal attacks. */
function validateId(id: string): void {
  if (!id || /[/\\:*?"<>|]/.test(id) || id.includes("..")) {
    throw new Error(`Invalid id: ${id}`);
  }
}

function caseSetPath(id: string): string {
  validateId(id);
  return path.join(caseSetsDir(), `${id}.json`);
}

/* ------------------------------------------------------------------ */
/*  CRUD                                                               */
/* ------------------------------------------------------------------ */

export function listCaseSets(): CaseSetListItem[] {
  ensureDir(caseSetsDir());
  const dir = caseSetsDir();
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));

  const results: CaseSetListItem[] = [];
  for (const file of files) {
    try {
      const raw = fs.readFileSync(path.join(dir, file), "utf-8");
      const cs = JSON.parse(raw) as CaseSet;
      results.push({
        id: cs.id,
        name: cs.name,
        caseCount: cs.cases.length,
        createdAt: cs.createdAt,
        updatedAt: cs.updatedAt,
      });
    } catch (err) {
      logger.warn("Skipping corrupt case-set file", { file, error: String(err) });
    }
  }

  return results.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export function getCaseSet(id: string): CaseSet | null {
  const fp = caseSetPath(id);
  if (!fs.existsSync(fp)) return null;
  try {
    return JSON.parse(fs.readFileSync(fp, "utf-8")) as CaseSet;
  } catch {
    return null;
  }
}

export function saveCaseSet(cs: CaseSet): void {
  ensureDir(caseSetsDir());
  fs.writeFileSync(caseSetPath(cs.id), JSON.stringify(cs, null, 2), "utf-8");
  logger.info("Case set saved", { id: cs.id, name: cs.name, caseCount: cs.cases.length });
}

export function deleteCaseSet(id: string): boolean {
  const fp = caseSetPath(id);
  if (!fs.existsSync(fp)) return false;
  fs.unlinkSync(fp);
  logger.info("Case set deleted", { id });
  return true;
}

/** Generate a short, path-safe case set id. */
function generateCaseSetId(): string {
  return randomUUID().replace(/-/g, "").slice(0, 12);
}

function normalizeCaseIdText(raw: unknown, fallback: string): string {
  const text = raw == null ? "" : String(raw).trim();
  const base = text || fallback;
  const safe = base
    .replace(/[/\\:*?"<>|]/g, "-")
    .replace(/\.\./g, ".")
    .trim();
  return safe || fallback;
}

export function makeUniqueCaseId(
  raw: unknown,
  index: number,
  used: Set<string>
): { caseId: string; changed: boolean } {
  const fallback = `case-${index + 1}`;
  const base = normalizeCaseIdText(raw, fallback);
  let candidate = base;
  let suffix = 2;

  while (used.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix++;
  }

  used.add(candidate);
  return { caseId: candidate, changed: candidate !== String(raw ?? "").trim() };
}

export function ensureUniqueCaseIds(cases: TestCase[]): TestCase[] {
  const used = new Set<string>();
  return cases.map((testCase, index) => {
    const { caseId } = makeUniqueCaseId(testCase.caseId, index, used);
    return caseId === testCase.caseId ? testCase : { ...testCase, caseId };
  });
}

/**
 * Create and persist an empty case set.
 *
 * Used when the user explicitly creates a new (empty) set to fill in later.
 * Unlike {@link importCaseSet}, this intentionally allows zero cases.
 */
export function createEmptyCaseSet(name: string): CaseSet {
  const now = new Date().toISOString();
  const caseSet: CaseSet = {
    id: generateCaseSetId(),
    name,
    cases: [],
    createdAt: now,
    updatedAt: now,
  };
  saveCaseSet(caseSet);
  return caseSet;
}

/**
 * Whether a create-case-set payload represents "no cases" (a new empty set).
 *
 * Matches: omitted/null, an empty array, or an object with an empty `cases`
 * array. Malformed shapes (non-array, object without a `cases` array) are NOT
 * treated as empty so they still hit {@link importCaseSet}'s format validation.
 */
export function isEmptyCasePayload(data: unknown): boolean {
  if (data == null) return true;
  if (Array.isArray(data)) return data.length === 0;
  if (typeof data === "object") {
    const inner = (data as Record<string, unknown>).cases;
    if (Array.isArray(inner)) return inner.length === 0;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/*  Import                                                             */
/* ------------------------------------------------------------------ */

/**
 * Create a CaseSet from a raw JSON payload.
 *
 * Accepts either:
 *   1. An array of case objects (legacy ragchat-server format).
 *   2. An object with a `cases` array and optional metadata.
 *
 * Legacy ragchat-server case fields:
 *   - case_id / caseId
 *   - question
 *   - answer / expectedAnswer
 *   - judgment
 *   - logic / expectedLogic
 */
export function importCaseSet(
  name: string,
  payload: unknown
): { caseSet: CaseSet; warnings: string[] } {
  const warnings: string[] = [];

  /** Maximum number of cases per import to prevent resource exhaustion. */
  const MAX_IMPORT_CASES = 10_000;

  let rawCases: unknown[];
  if (Array.isArray(payload)) {
    rawCases = payload;
  } else if (
    payload &&
    typeof payload === "object" &&
    Array.isArray((payload as Record<string, unknown>).cases)
  ) {
    rawCases = (payload as Record<string, unknown>).cases as unknown[];
  } else {
    throw new Error("Payload must be an array of cases or an object with a cases array");
  }

  if (rawCases.length > MAX_IMPORT_CASES) {
    throw new Error(`Too many cases (${rawCases.length}). Maximum is ${MAX_IMPORT_CASES}.`);
  }

  const cases: TestCase[] = [];
  const usedCaseIds = new Set<string>();
  for (let i = 0; i < rawCases.length; i++) {
    const item = rawCases[i];
    if (!item || typeof item !== "object") {
      warnings.push(`Item at index ${i} is not an object, skipped`);
      continue;
    }

    const obj = item as Record<string, unknown>;
    const rawCaseId = obj.case_id ?? obj.caseId;
    const { caseId, changed: caseIdChanged } = makeUniqueCaseId(rawCaseId, i, usedCaseIds);
    const question = String(obj.question ?? "").trim();

    if (!question) {
      warnings.push(`Item at index ${i} (caseId: ${caseId}) has no question, skipped`);
      continue;
    }

    if (rawCaseId != null && caseIdChanged) {
      warnings.push(`Item at index ${i} caseId normalized to ${caseId}`);
    }

    const expectedAnswer =
      obj.expectedAnswer != null
        ? String(obj.expectedAnswer)
        : obj.answer != null
          ? String(obj.answer)
          : undefined;

    const expectedLogic =
      obj.expectedLogic != null
        ? String(obj.expectedLogic)
        : obj.logic != null
          ? String(obj.logic)
          : undefined;

    const judgment = obj.judgment != null ? String(obj.judgment) : undefined;

    cases.push({ caseId, question, expectedAnswer, expectedLogic, judgment });
  }

  if (cases.length === 0) {
    throw new Error("No valid cases found in payload");
  }

  const now = new Date().toISOString();
  const caseSet: CaseSet = {
    id: generateCaseSetId(),
    name,
    cases,
    createdAt: now,
    updatedAt: now,
  };

  saveCaseSet(caseSet);

  return { caseSet, warnings };
}
