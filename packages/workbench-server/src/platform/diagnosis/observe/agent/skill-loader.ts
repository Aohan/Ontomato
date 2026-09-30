import { diagnosisSkillsDir } from "../../../../content/layout";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { parseSkillMarkdownFrontmatter, SkillIdSchema } from "../../../../core/skills/manifest";
import { createLogger } from "../../../../logging/logger";
import { tApp } from "../../../../i18n";


const logger = createLogger("observe:skill-loader");

/* ================================================================== */
/*  Types                                                              */
/* ================================================================== */

export interface SkillInfo {
  /** Stable skill name, used for lookup and model-visible listing. */
  name: string;
  /** Short model-visible description explaining when to use the skill. */
  description: string;
  /** Absolute path to the SKILL.md file. */
  filePath: string;
}



/* ================================================================== */
/*  Skill directory scanning                                           */
/* ================================================================== */

/**
 * Resolve the skill directory relative to the project root (cwd).
 */
export function resolveSkillDir(): string {
  return diagnosisSkillsDir();
}

/**
 * Scan the skill directory and return metadata for all valid skills.
 *
 * A valid skill is a subdirectory containing a `SKILL.md` file whose
 * frontmatter explicitly declares a valid `name` and non-empty `description`.
 * Invalid or duplicate declarations are skipped with a warning log.
 *
 * @param skillDir - Absolute path to the skill root directory.
 */
export function loadSkills(skillDir: string): SkillInfo[] {
  if (!fs.existsSync(skillDir)) {
    logger.info("Skill directory does not exist, skipping", { skillDir });
    return [];
  }

  let entries: fs.Dirent[];
  try {
    entries = fs
      .readdirSync(skillDir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch (err) {
    logger.warn("Failed to read skill directory", {
      skillDir,
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }

  const skills: SkillInfo[] = [];
  const names = new Set<string>();

  for (const entry of entries) {
    // Only process subdirectories
    if (!entry.isDirectory()) continue;
    // Skip hidden directories
    if (entry.name.startsWith(".")) continue;

    const skillMdPath = path.join(skillDir, entry.name, "SKILL.md");
    if (!fs.existsSync(skillMdPath)) continue;

    let content: string;
    try {
      content = fs.readFileSync(skillMdPath, "utf-8");
    } catch (err) {
      logger.warn("Failed to read SKILL.md", {
        path: skillMdPath,
        error: err instanceof Error ? err.message : String(err),
      });
      continue;
    }

    const PlatformSkillFrontmatterSchema = z.object({
      name: SkillIdSchema,
      description: z.string().trim().min(1, tApp("diag.observe.agent.skill-loader.0")),
    });
    let frontmatter: z.infer<typeof PlatformSkillFrontmatterSchema>;
    try {
      const parsed = parseSkillMarkdownFrontmatter(content);
      const result = PlatformSkillFrontmatterSchema.safeParse(parsed?.frontmatter);
      if (!result.success) {
        logger.warn("Skill skipped: invalid frontmatter", {
          path: skillMdPath,
          directory: entry.name,
          error: result.error.message,
        });
        continue;
      }
      frontmatter = result.data;
    } catch (err) {
      logger.warn("Skill skipped: invalid frontmatter", {
        path: skillMdPath,
        directory: entry.name,
        error: err instanceof Error ? err.message : String(err),
      });
      continue;
    }

    if (names.has(frontmatter.name)) {
      logger.warn("Skill skipped: duplicate name", {
        path: skillMdPath,
        directory: entry.name,
        name: frontmatter.name,
      });
      continue;
    }
    names.add(frontmatter.name);

    skills.push({
      name: frontmatter.name,
      description: frontmatter.description,
      filePath: path.resolve(skillMdPath),
    });
  }

  if (skills.length > 0) {
    logger.info(`Loaded ${skills.length} skill(s)`, {
      skills: skills.map((s) => s.name),
    });
  }

  return skills;
}

/* ================================================================== */
/*  XML formatting for system prompt injection                         */
/* ================================================================== */

/**
 * Format a list of skills into an `<available_skills>` XML block
 * suitable for injection into the system prompt.
 *
 * Returns an empty string when the list is empty (no block injected).
 */
export function formatSkillsIndex(skills: SkillInfo[]): string {
  if (skills.length === 0) return "";

  const lines = [
    "",
    "## Available Skills",
    "",
    "The following skills provide specialized instructions for specific diagnosis tasks.",
    "Use the read tool to load a skill's file when the task matches its description.",
    "The skill file path is the value inside <location>; it is the absolute path to that skill's SKILL.md.",
    "When a skill file references a relative path, resolve it against the skill directory (parent of SKILL.md / dirname of the path) and use that absolute path in tool commands.",
    "",
    "<available_skills>",
  ];

  for (const skill of skills) {
    lines.push("  <skill>");
    lines.push(`    <name>${escapeXml(skill.name)}</name>`);
    lines.push(`    <description>${escapeXml(skill.description)}</description>`);
    lines.push(`    <location>${escapeXml(skill.filePath)}</location>`);
    lines.push("  </skill>");
  }

  lines.push("</available_skills>");
  return lines.join("\n");
}

/* ================================================================== */
/*  Helpers                                                            */
/* ================================================================== */

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
