import type { AgentTool } from "../../../../core/agent-loop/index";
import { loadSkills, formatSkillsIndex, resolveSkillDir, type SkillInfo } from "./skill-loader";
import { createDiagnosisTools } from "./tools/index";
import type { DiagnosisCallerIdentity } from "./tools/caller-identity";
import { loadDiagnosisAgentRoles, type DiagnosisAgentRole } from "./role-loader";

export interface DiagnosisRuntimeCapabilities {
  tools: AgentTool[];
  skillsIndex: string;
  roles: DiagnosisAgentRole[];
}

let cachedSkills: SkillInfo[] | null = null;
let cachedRoles: DiagnosisAgentRole[] | null = null;

export function getDiagnosisSkillsIndex(): string {
  if (cachedSkills === null) {
    cachedSkills = loadSkills(resolveSkillDir());
  }
  return formatSkillsIndex(cachedSkills);
}

export function createDiagnosisRuntimeCapabilities(
  caller: DiagnosisCallerIdentity
): DiagnosisRuntimeCapabilities {
  return {
    tools: createDiagnosisTools(caller),
    skillsIndex: getDiagnosisSkillsIndex(),
    roles: getDiagnosisAgentRoles(),
  };
}

export function getDiagnosisAgentRoles(): DiagnosisAgentRole[] {
  if (cachedRoles === null) cachedRoles = loadDiagnosisAgentRoles();
  return cachedRoles;
}

export const __test__ = {
  resetSkillCache(): void {
    cachedSkills = null;
  },
  resetRoleCache(): void {
    cachedRoles = null;
  },
};
