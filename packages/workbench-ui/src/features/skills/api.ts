import type { SkillInfo } from "@ontomato/contracts/skills";
export type AnalysisSkill = Pick<
  SkillInfo,
  "id" | "type" | "title" | "description" | "category" | "tags" | "useCases" | "enabled"
>;
import {
  nodeApiDelete,
  nodeApiGet,
  nodeApiPost,
  nodeApiPostFormData,
  nodeApiPut,
} from "../../utils/api";
import { apiUrl } from "../../utils/api-base";
import { workbenchContent } from "../../content";

async function fetchSkills() {
  return nodeApiGet("/skills");
}

async function listSkills(category: AnalysisSkill["category"]): Promise<AnalysisSkill[]> {
  const response = await fetchSkills();
  if (response?.success !== true || !Array.isArray(response.skills)) {
    throw new Error(workbenchContent().text.skillsListInvalid);
  }

  const skills: AnalysisSkill[] = response.skills;
  return skills.filter(
    (skill) =>
      skill.category === category && (category !== "visualization" || skill.type === "executable")
  );
}

export const skillsApi = {
  fetchSkills,
  listAnalysisSkills: () => listSkills("analysis"),
  listVisualizationSkills: () => listSkills("visualization"),
  toggleSkill: (skillId: string) => nodeApiPut(`/skills/${skillId}/toggle`),
  getReferences: (skillId: string) => nodeApiGet(`/skills/${skillId}/references`),
  deleteSkill: (skillId: string) => nodeApiDelete(`/skills/${skillId}`),
  getScript: (skillId: string) => nodeApiGet(`/skills/${skillId}/script`),
  getContent: (skillId: string) => nodeApiGet(`/skills/${skillId}/content`),
  updateSkill: (skillId: string, body: unknown) => nodeApiPut(`/skills/${skillId}`, body),
  createSkill: (body: unknown) => nodeApiPost("/skills", body),
  importSkill: (formData: FormData, overwrite = false) =>
    nodeApiPostFormData(overwrite ? "/skills/import?overwrite=true" : "/skills/import", formData),
  debugSkill: (skillId: string, input: unknown) =>
    nodeApiPost(`/skills/${skillId}/debug`, { input }),
  exportUrl: (skillId: string, query: string) =>
    apiUrl(`/skills/${skillId}/export${query ? `?${query}` : ""}`),
};
