export const SkillType = {
  EXECUTABLE: "executable",
  KNOWLEDGE: "knowledge",
} as const;

export type SkillTypeValue = (typeof SkillType)[keyof typeof SkillType];

export const SkillCategory = {
  ANALYSIS: "analysis",
  VISUALIZATION: "visualization",
} as const;

export type SkillCategoryValue = (typeof SkillCategory)[keyof typeof SkillCategory];

export const SkillDir = {
  ROOT: "skills",
} as const;

export const SkillStatesFile = "skill-states.json";
