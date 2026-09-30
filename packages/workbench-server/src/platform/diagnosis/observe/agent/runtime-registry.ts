import type { AgentTool } from "../../../../core/agent-loop/index";
import { loadSkills, formatSkillsIndex, resolveSkillDir, type SkillInfo } from "./skill-loader";
import { createDiagnosisTools } from "./tools/index";
import type { CallerHolder } from "./tools/caller-holder";
import { loadDiagnosisAgentRoles, type DiagnosisAgentRole } from "./role-loader";

export interface DiagnosisRuntimeCapabilities {
  tools: AgentTool[];
  skillsIndex: string;
  callerHolder: CallerHolder;
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

export function createDiagnosisRuntimeCapabilities(): DiagnosisRuntimeCapabilities {
  const callerHolder: CallerHolder = {};
  return {
    callerHolder,
    tools: createDiagnosisTools(callerHolder),
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
