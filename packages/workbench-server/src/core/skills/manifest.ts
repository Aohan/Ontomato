import fs from "fs";
import path from "path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { z } from "zod";
import { tApp } from "../../i18n";
import { SkillCategory, SkillType } from "./constants";

export const SkillTypeSchema = z.enum([SkillType.EXECUTABLE, SkillType.KNOWLEDGE]);
export const SkillCategorySchema = z.enum([SkillCategory.ANALYSIS, SkillCategory.VISUALIZATION]);
// The pattern message is resolved at parse time, never at module load: importing
// this module before i18n configuration must not evaluate app text.
export const SkillIdSchema = z
  .string()
  .trim()
  .min(1)
  .superRefine((value, ctx) => {
    if (!/^[a-z0-9-]+$/.test(value)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: tApp("skills.manifest.idPattern") });
    }
  });

export function getSkillCombinationError(
  type: z.infer<typeof SkillTypeSchema>,
  category: z.infer<typeof SkillCategorySchema>
): string | null {
  if (category === SkillCategory.VISUALIZATION && type !== SkillType.EXECUTABLE) {
    return tApp("skills.manifest.comboVizType");
  }
  return null;
}

export function normalizeSkillPackagePath(value: string): string | null {
  const normalized = value.trim().replace(/\\/g, "/");
  if (!normalized || normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized)) {
    return null;
  }

  const segments = normalized.split("/").filter((segment) => segment !== "" && segment !== ".");
  if (segments.length === 0 || segments.some((segment) => segment === "..")) {
    return null;
  }
  return segments.join("/");
}

const commonFrontmatterFields = {
  name: SkillIdSchema,
  description: z.string().trim().superRefine((value, ctx) => {
    if (value.length < 1) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: tApp("skills.manifest.manifestDescEmpty") });
    }
  }),
  category: SkillCategorySchema,
  title: z.string().optional(),
  tags: z.array(z.string()).default([]),
  useCases: z.array(z.string()).optional(),
  timeout: z.number().optional(),
  retries: z.number().optional(),
  outputType: z.enum(["html", "json", "text"]).optional(),
  inputSchema: z.record(z.unknown()).optional(),
  outputSchema: z.record(z.unknown()).optional(),
  version: z.string().default("1.0.0"),
};

export const SkillManifestSchema = z
  .discriminatedUnion("type", [
    z.object({
      ...commonFrontmatterFields,
      type: z.literal(SkillType.EXECUTABLE),
      entries: z
        .array(
          z
            .string()
            .trim()
            .superRefine((value, ctx) => {
              if (normalizeSkillPackagePath(value) === null) {
                ctx.addIssue({ code: z.ZodIssueCode.custom, message: tApp("skills.manifest.entriesRelative") });
              }
            })
            .transform((value) => normalizeSkillPackagePath(value)!)
        )
        .superRefine((entries, ctx) => {
          if (entries.length < 1) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, message: tApp("skills.manifest.entriesRequired") });
          }
        }),
    }),
    z.object({
      ...commonFrontmatterFields,
      type: z.literal(SkillType.KNOWLEDGE),
    }),
  ])
  .superRefine((manifest, ctx) => {
    const combinationError = getSkillCombinationError(manifest.type, manifest.category);
    if (combinationError) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["type"],
        message: combinationError,
      });
    }
  })
  .transform((manifest) =>
    manifest.type === SkillType.EXECUTABLE ? { ...manifest, entry: manifest.entries[0] } : manifest
  );

export type SkillManifest = z.infer<typeof SkillManifestSchema> & { entry?: string };

export interface ParsedSkillMarkdown {
  manifest: SkillManifest;
  content: string;
}

export interface ParsedSkillMarkdownFrontmatter {
  frontmatter: unknown;
  content: string;
}

export class InvalidSkillPackageError extends Error {
  readonly code = "INVALID_SKILL_PACKAGE";
  readonly status = 400;

  constructor(message: string) {
    super(message);
    this.name = "InvalidSkillPackageError";
  }
}

function splitSkillMarkdown(markdown: string): { frontmatter: string; content: string } | null {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  if (lines[0] !== "---") return null;

  const closingIndex = lines.indexOf("---", 1);
  if (closingIndex < 0) {
    throw new InvalidSkillPackageError(tApp("skills.manifest.fmMissingClose"));
  }
  return {
    frontmatter: lines.slice(1, closingIndex).join("\n"),
    content: lines.slice(closingIndex + 1).join("\n"),
  };
}

function formatSchemaIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "frontmatter"}: ${issue.message}`)
    .join(tApp("skills.manifest.fmSeparator"));
}

export function parseSkillMarkdownFrontmatter(
  markdown: string
): ParsedSkillMarkdownFrontmatter | null {
  const sections = splitSkillMarkdown(markdown);
  if (!sections) return null;

  try {
    return {
      frontmatter: parseYaml(sections.frontmatter),
      content: sections.content,
    };
  } catch (error) {
    throw new InvalidSkillPackageError(
      tApp("skills.manifest.fmYamlParse", {
        error: error instanceof Error ? error.message : String(error),
      })
    );
  }
}

export function parseSkillMarkdown(markdown: string): ParsedSkillMarkdown | null {
  const parsed = parseSkillMarkdownFrontmatter(markdown);
  if (!parsed) return null;

  const result = SkillManifestSchema.safeParse(parsed.frontmatter);
  if (!result.success) {
    throw new InvalidSkillPackageError(
      tApp("skills.manifest.fmInvalid", { issues: formatSchemaIssues(result.error) })
    );
  }
  return { manifest: result.data, content: parsed.content };
}

export function readSkillMarkdown(skillMdPath: string): ParsedSkillMarkdown | null {
  return parseSkillMarkdown(fs.readFileSync(skillMdPath, "utf-8"));
}

export function writeSkillMarkdown(
  skillMdPath: string,
  manifest: SkillManifest,
  content: string
): void {
  const frontmatter = {
    name: manifest.name,
    description: manifest.description,
    type: manifest.type,
    category: manifest.category,
    title: manifest.title,
    tags: manifest.tags,
    useCases: manifest.useCases,
    timeout: manifest.timeout,
    retries: manifest.retries,
    outputType: manifest.outputType,
    inputSchema: manifest.inputSchema,
    outputSchema: manifest.outputSchema,
    version: manifest.version,
    ...(manifest.type === SkillType.EXECUTABLE ? { entries: manifest.entries } : {}),
  };
  const yaml = stringifyYaml(frontmatter, { lineWidth: 0 }).trimEnd();
  fs.writeFileSync(skillMdPath, `---\n${yaml}\n---\n${content}`);
}

export function migrateLegacySkillManifest(skillPath: string): void {
  const manifestPath = path.join(skillPath, "manifest.json");
  if (!fs.existsSync(manifestPath)) return;

  const skillMdPath = path.join(skillPath, "SKILL.md");
  const currentMarkdown = fs.existsSync(skillMdPath) ? fs.readFileSync(skillMdPath, "utf-8") : "";
  try {
    if (parseSkillMarkdown(currentMarkdown)) {
      fs.unlinkSync(manifestPath);
      return;
    }
  } catch {
    // A valid legacy manifest replaces malformed or incomplete registration frontmatter.
  }

  let legacyJson: unknown;
  try {
    legacyJson = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  } catch {
    throw new InvalidSkillPackageError(tApp("skills.manifest.manifestJsonInvalid"));
  }

  const legacySchema = z.object({
    id: SkillIdSchema,
    description: z.string().optional(),
    type: SkillTypeSchema,
    category: SkillCategorySchema,
    title: z.string().optional(),
    tags: z.array(z.string()).default([]),
    useCases: z.array(z.string()).optional(),
    timeout: z.number().optional(),
    retries: z.number().optional(),
    outputType: z.enum(["html", "json", "text"]).optional(),
    inputSchema: z.record(z.unknown()).optional(),
    outputSchema: z.record(z.unknown()).optional(),
    version: z.string().default("1.0.0"),
    entry: z.string().optional(),
  });
  const legacyResult = legacySchema.safeParse(legacyJson);
  if (!legacyResult.success) {
    throw new InvalidSkillPackageError(
      tApp("skills.manifest.manifestValidationInvalid", {
        issues: formatSchemaIssues(legacyResult.error),
      })
    );
  }

  const { id, entry, ...legacyFields } = legacyResult.data;
  const manifestResult = SkillManifestSchema.safeParse({
    ...legacyFields,
    name: id,
    description: legacyFields.description?.trim() || legacyFields.title?.trim() || id,
    entries: entry ? [entry] : undefined,
  });
  if (!manifestResult.success) {
    throw new InvalidSkillPackageError(
      tApp("skills.manifest.manifestValidationInvalid", {
        issues: formatSchemaIssues(manifestResult.error),
      })
    );
  }

  const sections = splitSkillMarkdown(currentMarkdown);
  writeSkillMarkdown(skillMdPath, manifestResult.data, sections?.content ?? currentMarkdown);
  fs.unlinkSync(manifestPath);
}

export function assertSkillPackageComplete(
  manifest: SkillManifest,
  hasFile: (relativePath: string) => boolean,
  content: string
): void {
  if (manifest.type === SkillType.EXECUTABLE) {
    const missingEntry = manifest.entries.find((entry) => !hasFile(entry));
    if (missingEntry) {
      throw new InvalidSkillPackageError(
        tApp("skills.manifest.entryMissingFile", { name: missingEntry })
      );
    }
    return;
  }

  if (!content.trim()) {
    throw new InvalidSkillPackageError(tApp("skills.manifest.knowledgeEmpty"));
  }
}
