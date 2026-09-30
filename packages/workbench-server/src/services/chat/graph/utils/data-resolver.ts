import { createLogger } from "../../../../logging/logger";
import { createModel } from "../../../../config/model-factory";
import { modelAgentName } from "../../../../logging/model-agents";
import { t, tApp } from "../../../../i18n";
import { getPromptTemplate } from "../../../../core/prompts/loader";
import { workbenchProduct } from "../../../../product/installed";

const logger = createLogger("data-resolver");

export interface DataSourceResult {
  success: boolean;
  data: Record<string, unknown>[] | null;
  source: string;
  error?: string;
}

function detectUserProvidedData(query: string): boolean {
  const hasArrayPattern = query.includes("[") && query.includes("]");
  const keywords = workbenchProduct().userDataKeywords;
  const hasDataKeyword = keywords.data.some((word) => query.includes(word));
  const hasOptionKeyword = keywords.option.some((word) => query.includes(word));
  return hasArrayPattern || (hasDataKeyword && hasOptionKeyword);
}

async function parseUserProvidedData(query: string): Promise<Record<string, unknown>[] | null> {
  const truncatedQuery = query.length > 4000 ? query.slice(0, 4000) + tApp("queryFixed.104") : query;

  try {
    const model = await createModel({ agentName: modelAgentName("dataResolver") });
    const response = await model.invoke([
      {
        role: "system",
        content: getPromptTemplate("standard-chat.data-resolver.user-provided.system"),
      },
      { role: "user", content: tApp("queryFixed.99", { v0: (truncatedQuery) }) },
    ]);

    const content = response.content.toString().trim();
    const jsonMatch = content.match(/\[[\s\S]*\]/);

    if (jsonMatch) {
      const data = JSON.parse(jsonMatch[0]);
      if (data && data.length > 0) {
        logger.info(tApp("queryFixed.100", { v0: (data.length) }));
        return data;
      }
    }
    return null;
  } catch (error) {
    logger.error(tApp("queryFixed.105"), error);
    return null;
  }
}

async function generateMockData(query: string): Promise<Record<string, unknown>[] | null> {
  try {
    const model = await createModel({ temperature: 0.7, agentName: modelAgentName("dataResolver") });
    const response = await model.invoke([
      {
        role: "system",
        content: getPromptTemplate("standard-chat.data-resolver.mock.system"),
      },
      { role: "user", content: tApp("queryFixed.101", { v0: (query) }) },
    ]);

    const content = response.content.toString().trim();
    const jsonMatch = content.match(/\[[\s\S]*?\]/);

    if (jsonMatch) {
      const data = JSON.parse(jsonMatch[0]);
      if (data && data.length > 0) {
        logger.info(tApp("queryFixed.102", { v0: (data.length) }));
        return data;
      }
    }
    return getDefaultMockData();
  } catch (error) {
    logger.error(tApp("queryFixed.106"), error);
    return getDefaultMockData();
  }
}

function getDefaultMockData(): Record<string, unknown>[] {
  return [
    { name: tApp("queryFixed.107"), value: 30 },
    { name: tApp("queryFixed.108"), value: 25 },
    { name: tApp("queryFixed.109"), value: 20 },
    { name: tApp("queryFixed.110"), value: 15 },
    { name: tApp("queryFixed.111"), value: 10 },
  ];
}

export async function resolveVisualizationData(
  query: string,
  queryResult: any,
  mockData: Record<string, unknown>[] | undefined
): Promise<DataSourceResult> {
  let data: Record<string, unknown>[] | null = null;
  let source = "unknown";

  if (queryResult && queryResult.result?.data) {
    const datasets = queryResult.result.data;
    if (Array.isArray(datasets) && datasets.length > 0) {
      const lastDataset = datasets[datasets.length - 1];
      if (lastDataset && lastDataset.data) {
        data = lastDataset.data;
        source = "query_result";
        logger.info(
          tApp("queryFixed.103", { v0: (lastDataset.name || tApp("queryFixed.112")), v1: (lastDataset.data.length) })
        );
      }
    }
  }

  if (!data && mockData && mockData.length > 0) {
    data = mockData;
    source = "user_mock";
    logger.info(tApp("queryFixed.113"));
  }

  if (!data && detectUserProvidedData(query)) {
    const userProvidedData = await parseUserProvidedData(query);
    if (userProvidedData && userProvidedData.length > 0) {
      data = userProvidedData;
      source = "user_provided";
      logger.info(tApp("queryFixed.114"));
    }
  }

  if (!data) {
    data = await generateMockData(query);
    if (data) {
      source = "mock_generated";
      logger.info(tApp("queryFixed.115"));
    }
  }

  if (!data) {
    return {
      success: false,
      error: t("dataResolver.cannotGetData"),
      data: null,
      source: "none",
    };
  }

  return { success: true, data, source };
}
