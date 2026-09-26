import type { AnalysisAgentSkillReference } from "@ontomato/contracts/skills";
import { getPostgresPool, qualifiedTable } from "../../../infrastructure/postgres";

export async function listAnalysisAgentSkillReferences(
  domainId: string,
  skillId: string
): Promise<AnalysisAgentSkillReference[]> {
  const result = await getPostgresPool().query(
    `SELECT id, name,
       $1 = ANY(COALESCE(enabled_skill_ids, ARRAY[]::TEXT[])) AS uses_analysis,
       $1 = ANY(COALESCE(enabled_visualization_skill_ids, ARRAY[]::TEXT[])) AS uses_visualization
     FROM ${qualifiedTable("analysis_agents")}
     WHERE domain_id = $2
       AND (
         $1 = ANY(COALESCE(enabled_skill_ids, ARRAY[]::TEXT[]))
         OR $1 = ANY(COALESCE(enabled_visualization_skill_ids, ARRAY[]::TEXT[]))
       )
     ORDER BY sort_order ASC, created_at DESC`,
    [skillId, domainId]
  );
  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    usesAnalysis: row.uses_analysis === true,
    usesVisualization: row.uses_visualization === true,
  }));
}

export async function removeAnalysisAgentSkillReferences(
  domainId: string,
  skillId: string
): Promise<number> {
  const result = await getPostgresPool().query(
    `UPDATE ${qualifiedTable("analysis_agents")}
     SET enabled_skill_ids = array_remove(COALESCE(enabled_skill_ids, ARRAY[]::TEXT[]), $1),
         enabled_visualization_skill_ids = array_remove(
           COALESCE(enabled_visualization_skill_ids, ARRAY[]::TEXT[]), $1
         ),
         updated_at = $3
     WHERE domain_id = $2
       AND (
         $1 = ANY(COALESCE(enabled_skill_ids, ARRAY[]::TEXT[]))
         OR $1 = ANY(COALESCE(enabled_visualization_skill_ids, ARRAY[]::TEXT[]))
       )`,
    [skillId, domainId, Date.now()]
  );
  return result.rowCount ?? 0;
}

export async function restoreAnalysisAgentSkillReferences(
  domainId: string,
  skillId: string,
  references: AnalysisAgentSkillReference[]
): Promise<void> {
  for (const reference of references) {
    await getPostgresPool().query(
      `UPDATE ${qualifiedTable("analysis_agents")}
       SET enabled_skill_ids = CASE
             WHEN $2 AND NOT ($1 = ANY(COALESCE(enabled_skill_ids, ARRAY[]::TEXT[])))
               THEN array_append(COALESCE(enabled_skill_ids, ARRAY[]::TEXT[]), $1)
             ELSE enabled_skill_ids
           END,
           enabled_visualization_skill_ids = CASE
             WHEN $3 AND NOT (
               $1 = ANY(COALESCE(enabled_visualization_skill_ids, ARRAY[]::TEXT[]))
             ) THEN array_append(COALESCE(enabled_visualization_skill_ids, ARRAY[]::TEXT[]), $1)
             ELSE enabled_visualization_skill_ids
           END,
           updated_at = $4
       WHERE id = $5 AND domain_id = $6`,
      [
        skillId,
        reference.usesAnalysis,
        reference.usesVisualization,
        Date.now(),
        reference.id,
        domainId,
      ]
    );
  }
}
