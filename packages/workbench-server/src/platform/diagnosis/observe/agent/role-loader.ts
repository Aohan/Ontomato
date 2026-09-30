import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { resolvePromptDirectory } from "../../../../core/prompts/loader";
import { parseSkillMarkdownFrontmatter } from "../../../../core/skills/manifest";

export interface DiagnosisAgentRole {
  name: string;
  description: string;
  tools: string[];
  systemPrompt: string;
}

const DiagnosisAgentRoleFrontmatterSchema = z
  .object({
    name: z.string().trim().min(1),
    description: z.string().trim().min(1),
    tools: z.string().trim().min(1),
  })
  .strict();

export function loadDiagnosisAgentRoles(
  directory = resolvePromptDirectory("diagnosis-agent.roles")
): DiagnosisAgentRole[] {
  if (!fs.existsSync(directory)) return [];

  const roles: DiagnosisAgentRole[] = [];
  const names = new Set<string>();
  for (const entry of fs
    .readdirSync(directory, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) {
      continue;
    }

    const filePath = path.join(directory, entry.name);
    const content = fs.readFileSync(filePath, "utf-8");
    let parsed: ReturnType<typeof parseSkillMarkdownFrontmatter> = null;
    try {
      parsed = parseSkillMarkdownFrontmatter(content);
    } catch {
      // Invalid YAML is handled by the role declaration boundary below.
    }
    const frontmatter = DiagnosisAgentRoleFrontmatterSchema.safeParse(parsed?.frontmatter);
    const systemPrompt = parsed?.content.trim() ?? "";
    if (!frontmatter.success || !systemPrompt) {
      throw new Error(`Invalid diagnosis agent role: ${filePath}`);
    }

    const { name, description } = frontmatter.data;
    const tools = frontmatter.data.tools
      .split(",")
      .map((tool) => tool.trim())
      .filter(Boolean);

    if (tools.length === 0) {
      throw new Error(`Invalid diagnosis agent role: ${filePath}`);
    }
    if (names.has(name)) {
      throw new Error(`Duplicate diagnosis agent role: ${name}`);
    }
    names.add(name);
    roles.push({ name, description, tools, systemPrompt });
  }

  return roles;
}
