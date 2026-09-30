import type { AnalysisReportCardSummary } from "@ontomato/contracts/analysis-report";
import { createLogger } from "../../../logging/logger";
import { getAnalysisAgentService } from "../runtime";
import { listCards } from "./analysis-report-hot-cards";
import { tApp } from "../../../i18n";


const logger = createLogger("api:analysis-reports");
function unknownAnalysisAgentName(): string {
  return tApp("analysis.hot-card.card-summary.213");
}

async function buildAgentNameMap(domainId?: string): Promise<Map<string, string>> {
  try {
    const service = await getAnalysisAgentService();
    const agents = await service.listAgents(domainId);
    return new Map(agents.map((agent) => [agent.id, agent.name]));
  } catch (error) {
    logger.warn(tApp("analysis.hot-card.card-summary.214"), {
      error: String(error),
    });
    return new Map();
  }
}

function resolveAgentName(agentId: string | undefined, agentNameById: Map<string, string>): string {
  if (!agentId) {
    return unknownAnalysisAgentName();
  }
  return agentNameById.get(agentId) || unknownAnalysisAgentName();
}

export async function listCardSummariesWithAgentNames(
  domainId?: string,
  status?: string
): Promise<AnalysisReportCardSummary[]> {
  const [cards, agentNameById] = await Promise.all([
    listCards({ domainId, status }, { projection: "summary" }),
    buildAgentNameMap(domainId),
  ]);
  return cards.map((card) => ({
    id: card.id,
    question: card.question,
    agentId: card.agentId,
    agentName: resolveAgentName(card.agentId, agentNameById),
    status: card.status,
    businessDescription: card.businessDescription,
    dimensions: card.dimensions,
    questionTotal: card.questionTotal,
    createdAt: card.createdAt,
    updatedAt: card.updatedAt,
  }));
}
