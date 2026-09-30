import { tApp } from "../../i18n";
import type { AbcQuestionMode } from "@ontomato/contracts/system-model";
import { createLogger } from "../../logging/logger";
import { config } from "../../config/application";
import { getAbcQuestionMode } from "./data-query-policy";
import { backendPost } from "../../utils/backend-client";
import { workbenchProduct } from "../../product/installed";

const logger = createLogger("dataset-schema");

interface DatasetSchema {
  datasetDesc: string;
  classDef: string;
  relationshipDef: string;
  relationshipChain: string;
  raw: Record<string, any>;
}

function buildV2Url(path: string): string {
  const base = (config.dataQuery.baseUrl || "").replace(/\/$/, "");
  return `${base}${path}`;
}

function extractClassNamesFromMarkdown(classDefMd: string): string[] {
  if (!classDefMd) return [];
  const classNames = new Set<string>();
  const lines = classDefMd.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = trimmed.match(workbenchProduct().datasetClassPathPatterns.line);
    if (match) {
      classNames.add(match[1]);
      continue;
    }

    const tableCells = trimmed.startsWith("|")
      ? trimmed
          .split("|")
          .map((cell) => cell.trim())
          .filter(Boolean)
      : [];
    for (const cell of tableCells) {
      const tableCellMatch = cell.match(workbenchProduct().datasetClassPathPatterns.tableCell);
      if (tableCellMatch) {
        classNames.add(tableCellMatch[1]);
        break;
      }
    }
  }
  return Array.from(classNames);
}

function matchRelevantClassNames(question: string, classNames: string[]): string[] {
  if (!question || classNames.length === 0) return [];
  const lowerQuestion = question.toLowerCase();

  const scored = classNames.map((className) => {
    let score = 0;
    const segments = className.split("/").filter(Boolean);
    for (const seg of segments) {
      if (lowerQuestion.includes(seg.toLowerCase())) {
        score += seg.length;
      }
    }
    return { className, score };
  });

  const matched = scored.filter((item) => item.score > 0).sort((a, b) => b.score - a.score);

  if (matched.length === 0) return classNames;

  return matched.map((item) => item.className);
}

const MAX_CLASSES_PER_ENRICHMENT = 20;

class DatasetSchemaService {
  private baseUrl: string = "";

  setConfig(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  /**
   * Fetches the latest dataset description for the current question.
   * A base-description failure throws directly; failures while supplementing class attributes and relationships keep the base description.
   */
  async getSchemaForQuestion(
    question: string,
    token?: string,
    apiKey?: string,
    classNames?: string[]
  ): Promise<string> {
    if (!this.baseUrl) {
      throw new Error(tApp("queryFixed.233"));
    }

    const mode = getAbcQuestionMode();
    const selectedClassNames = normalizeClassNames(classNames);
    const schema = await this.fetchLatestSchema(token, apiKey, mode, selectedClassNames);
    if (mode === "no_tool_fixed") return this.formatMarkdownContent(schema);

    const allClassNames =
      selectedClassNames.length > 0
        ? selectedClassNames
        : extractClassNamesFromMarkdown(schema.classDef);
    if (allClassNames.length === 0) {
      return this.formatMarkdownContent(schema);
    }

    const relevantNames = matchRelevantClassNames(question, allClassNames);
    const toEnrich = relevantNames.slice(0, MAX_CLASSES_PER_ENRICHMENT);
    if (toEnrich.length === 0) return this.formatMarkdownContent(schema);

    logger.debug(tApp("queryFixed.234"), {
      question: question.slice(0, 80),
      totalClasses: allClassNames.length,
      matched: toEnrich.length,
      enriched: toEnrich.join(", ").slice(0, 200),
    });

    await this.enrichClassDetails(schema, toEnrich, token, apiKey);

    return this.formatMarkdownContent(schema);
  }

  private async fetchLatestSchema(
    token: string | undefined,
    apiKey: string | undefined,
    mode: AbcQuestionMode,
    classNames: string[]
  ): Promise<DatasetSchema> {
    try {
      const endpoint =
        mode === "no_tool_fixed" ? "/admin/getschemamarkdown" : "/admin/getschemamarkdown-v2";
      const schemaUrl = buildV2Url(endpoint);
      logger.debug(tApp("queryFixed.229", { v0: (schemaUrl) }));
      const schemaResp = await backendPost(
        `datasetSchema:${mode}`,
        schemaUrl,
        classNames.length > 0 ? { classNames } : {},
        { token, apiKey, timeoutMs: 30000 }
      );
      const schemaJson: any = JSON.parse(schemaResp.text);
      const schemaData = schemaJson?.data ?? schemaJson ?? {};
      const schema = {
        datasetDesc: String(schemaData.KEY_DATASET_DESC || ""),
        classDef: String(schemaData.KEY_CLASS_DEF || ""),
        relationshipDef: String(schemaData.KEY_RELATIONSHIP_DEF || ""),
        relationshipChain: String(schemaData.KEY_RELATIONSHIP_CHAIN || ""),
        raw: schemaData,
      };

      logger.debug(tApp("queryFixed.235"), {
        mode,
        datasetDescLen: schema.datasetDesc.length,
        classDefLen: schema.classDef.length,
        relationshipDefLen: schema.relationshipDef.length,
      });
      return schema;
    } catch (error) {
      logger.error(tApp("queryFixed.236"), { error, url: this.baseUrl });
      throw error;
    }
  }

  private async enrichClassDetails(
    schema: DatasetSchema,
    classNames: string[],
    token?: string,
    apiKey?: string
  ): Promise<void> {
    try {
      const attrUrl = buildV2Url("/admin/getSchemaByClassName");
      const attrResp = await backendPost(
        "datasetSchema:classAttrs",
        attrUrl,
        { classNames },
        { token, apiKey, timeoutMs: 30000 }
      );
      const attrJson: any = JSON.parse(attrResp.text);
      const classDefDetail: string =
        typeof (attrJson?.data ?? attrJson) === "string"
          ? (attrJson?.data ?? attrJson)
          : JSON.stringify(attrJson?.data ?? attrJson);

      if (classDefDetail) {
        schema.classDef = [schema.classDef, classDefDetail].filter(Boolean).join("\n\n");
      }

      logger.debug(tApp("queryFixed.237"), {
        classCount: classNames.length,
        detailLen: classDefDetail.length,
      });
    } catch (attrErr) {
      logger.warn(tApp("queryFixed.238"), { error: String(attrErr), classCount: classNames.length });
    }

    try {
      const relUrl = buildV2Url("/admin/getRelationshipByClassNames");
      const relResp = await backendPost(
        "datasetSchema:relationships",
        relUrl,
        { classNames },
        { token, apiKey, timeoutMs: 30000 }
      );
      const relJson: any = JSON.parse(relResp.text);
      const relationshipDef: string =
        typeof (relJson?.data ?? relJson) === "string"
          ? (relJson?.data ?? relJson)
          : JSON.stringify(relJson?.data ?? relJson);

      if (relationshipDef) {
        const existing = schema.relationshipDef || "";
        schema.relationshipDef = [existing, relationshipDef].filter(Boolean).join("\n\n");
      }

      logger.debug(tApp("queryFixed.239"), {
        classCount: classNames.length,
        detailLen: relationshipDef.length,
      });
    } catch (relErr) {
      logger.warn(tApp("queryFixed.240"), { error: String(relErr), classCount: classNames.length });
    }
  }

  private formatMarkdownContent(schema: DatasetSchema): string {
    const parts: string[] = [];

    if (schema.datasetDesc) {
      parts.push(tApp("queryFixed.230", { v0: (schema.datasetDesc) }));
    }

    if (schema.classDef) {
      parts.push(tApp("queryFixed.231", { v0: (schema.classDef) }));
    }

    if (schema.relationshipDef) {
      parts.push(tApp("queryFixed.232", { v0: (schema.relationshipDef) }));
    }

    if (schema.relationshipChain) {
      parts.push(schema.relationshipChain);
    }

    return parts.join("\n\n");
  }
}

export const datasetSchemaService = new DatasetSchemaService();

function normalizeClassNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((item) => String(item).trim()).filter(Boolean)));
}
