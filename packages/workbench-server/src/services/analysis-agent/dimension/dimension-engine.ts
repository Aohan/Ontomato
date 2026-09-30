import type { AnalysisDimension } from "@ontomato/contracts/analysis-agent";
import { createModel } from "../../../config/model-factory";
import { modelAgentName } from "../../../logging/model-agents";
import { createLogger } from "../../../logging/logger";
import type { PlannedDimension, DimensionalizedQuestion } from "./dimension-types";

import { estimateMessagesSize, truncateText } from "../../../utils/prompt-context";
import { renderPrompt } from "../../../core/prompts/loader";
import { config } from "../../../config/application";
import { backendPost } from "../../../utils/backend-client";
import { tApp } from "../../../i18n";


const logger = createLogger("dimension-engine");

interface PlanningInput {
  originalQuestion: string;
  datasetSchema: string;
  dimensions?: AnalysisDimension[];
  analysisDimensionPrompt?: string;
  token?: string;
  apiKey?: string;
}

interface PlanningOutputDimension {
  dimensionId: string;
  dimensionName: string;
  dimensionValue: string;
  reason?: string;
  subQuestions: string[];
}

interface PlanningOutput {
  dimensions: PlanningOutputDimension[];
}

/**
 * Dimension engine
 * Generates the dimension execution plan from the question, dataset schema, and agent prompts
 */
export class DimensionEngine {
  async planDimensions(input: PlanningInput): Promise<PlannedDimension[]> {
    const { originalQuestion, datasetSchema, dimensions, analysisDimensionPrompt, token, apiKey } =
      input;

    const availableDimensions = (dimensions || []).filter((dimension) => dimension.isEnabled);

    logger.info(tApp("analysis.dimension.dimension-engine.58"), {
      originalQuestion,
      availableDimensionCount: availableDimensions.length,
      hasDatasetSchema: !!datasetSchema,
      hasAnalysisDimensionPrompt: !!analysisDimensionPrompt?.trim(),
      planningMode: availableDimensions.length > 0 ? "configured_dimensions" : "prompt_only",
    });

    const dimensionPlans = await this.generateDimensionPlanWithLLM({
      originalQuestion,
      availableDimensions,
      datasetSchema,
      analysisDimensionPrompt,
    });

    if (dimensionPlans.length > 0) {
      logger.info(tApp("analysis.dimension.dimension-engine.59"), {
        dimensionCount: dimensionPlans.length,
        dimensions: dimensionPlans.map((dimension) => ({
          dimensionId: dimension.dimensionId,
          dimensionName: dimension.dimensionName,
          dimensionValue: dimension.dimensionValue,
          subQuestionCount: dimension.subQuestions.length,
        })),
      });
      return dimensionPlans;
    }

    if (availableDimensions.length === 0) {
      logger.warn(tApp("analysis.dimension.dimension-engine.60"));
      return [];
    }

    logger.warn(tApp("analysis.dimension.dimension-engine.61"));
    return this.fallbackGeneratePlan(originalQuestion, availableDimensions, token, apiKey);
  }

  private async generateDimensionPlanWithLLM(params: {
    originalQuestion: string;
    availableDimensions: AnalysisDimension[];
    datasetSchema: string;
    analysisDimensionPrompt?: string;
  }): Promise<PlannedDimension[]> {
    const { originalQuestion, availableDimensions, datasetSchema, analysisDimensionPrompt } =
      params;

    const dimensionSpecs = availableDimensions
      .slice(0, 12)
      .map((dimension) => {
        const valueInfo =
          dimension.valueSource === "static"
            ? tApp("analysis.dimension.dimension-engine.62", { value: (dimension.values || []).join(tApp("analysis.dimension.dimension-engine.63")) || tApp("analysis.dimension.dimension-engine.64") })
            : tApp("analysis.dimension.dimension-engine.65", { value: dimension.datasetField || tApp("analysis.dimension.dimension-engine.66") });
        return [
          `- dimensionId: ${dimension.id}`,
          tApp("analysis.dimension.dimension-engine.67", { name: dimension.name }),
          tApp("analysis.dimension.dimension-engine.68", { dimensionType: dimension.dimensionType }),
          tApp("analysis.dimension.dimension-engine.69", { valueSource: dimension.valueSource }),
          `  ${valueInfo}`,
          tApp("analysis.dimension.dimension-engine.70", { subQuestionTemplate: dimension.subQuestionTemplate }),
        ].join("\n");
      })
      .join("\n\n");

    const hasConfiguredDimensions = availableDimensions.length > 0;
    const dimensionSourceHint = hasConfiguredDimensions
      ? tApp("analysis.dimension.dimension-engine.71")
      : tApp("analysis.dimension.dimension-engine.72");
    const systemPrompt = renderPrompt("analysis-agent.dimension-planner.system", {
      dimensionSourceHint,
    });

    const userPrompt = [
      tApp("analysis.dimension.dimension-engine.73", { originalQuestion: originalQuestion }),
      datasetSchema ? tApp("analysis.dimension.dimension-engine.74", { datasetSchema: datasetSchema }) : tApp("analysis.dimension.dimension-engine.75"),
      hasConfiguredDimensions
        ? tApp("analysis.dimension.dimension-engine.76", { truncateText: truncateText(dimensionSpecs, 4000) })
        : tApp("analysis.dimension.dimension-engine.77"),
      analysisDimensionPrompt?.trim()
        ? tApp("analysis.dimension.dimension-engine.78", { truncateText: truncateText(analysisDimensionPrompt.trim(), 3000) })
        : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    try {
      const model = await createModel({ agentName: modelAgentName("analysisDimension") });
      const messages = [
        { role: "system" as const, content: systemPrompt },
        { role: "user" as const, content: userPrompt },
      ];

      logger.info(tApp("analysis.dimension.dimension-engine.79"), {
        promptLength: systemPrompt.length,
        messageCount: messages.length,
        messagesLength: estimateMessagesSize(messages),
      });

      const response = await model.invoke(messages);

      const content = String(response.content || "");
      logger.debug(tApp("analysis.dimension.dimension-engine.80"), content);
      const parsed = this.parsePlanningOutput(content);
      if (!parsed.dimensions.length) {
        return [];
      }

      const dimensionMap = new Map(
        availableDimensions.map((dimension) => [dimension.id, dimension])
      );

      const plannedDimensions: PlannedDimension[] = [];

      for (const dimensionPlan of parsed.dimensions) {
        const dimension = dimensionMap.get(dimensionPlan.dimensionId);
        const resolvedDimension =
          dimension ||
          this.createSyntheticDimension(dimensionPlan.dimensionId, dimensionPlan.dimensionName);

        const questions = dimensionPlan.subQuestions
          .map((subQuestion, index) =>
            this.createQuestionFromPlan({
              dimension: resolvedDimension,
              originalQuestion,
              dimensionValue: dimensionPlan.dimensionValue || resolvedDimension.name,
              subQuestion,
              index,
            })
          )
          .filter((question) => question.subQuestion.trim().length > 0);

        if (!questions.length) {
          continue;
        }

        plannedDimensions.push({
          dimensionId: resolvedDimension.id,
          dimensionName: resolvedDimension.name,
          dimensionValue: dimensionPlan.dimensionValue || resolvedDimension.name,
          reason: dimensionPlan.reason,
          subQuestions: questions,
        });
      }

      return plannedDimensions;
    } catch (error) {
      logger.error(tApp("analysis.dimension.dimension-engine.81"), error);
      return [];
    }
  }

  private parsePlanningOutput(content: string): PlanningOutput {
    const jsonMatch =
      content.match(/```json\s*(\{[\s\S]*?\})\s*```/) || content.match(/(\{[\s\S]*\})/);
    if (!jsonMatch) {
      return { dimensions: [] };
    }

    try {
      const parsed = JSON.parse(jsonMatch[1]);
      const dimensions = Array.isArray(parsed?.dimensions) ? parsed.dimensions : [];
      return {
        dimensions: dimensions
          .map((item: any) => ({
            dimensionId: String(item?.dimensionId || "").trim(),
            dimensionName: String(item?.dimensionName || "").trim(),
            dimensionValue: String(item?.dimensionValue || "").trim(),
            reason: item?.reason ? String(item.reason) : undefined,
            subQuestions: Array.isArray(item?.subQuestions)
              ? item.subQuestions
                  .filter((question: any): question is string => typeof question === "string")
                  .map((question: string) => question.trim())
                  .filter(Boolean)
              : [],
          }))
          .filter(
            (item: PlanningOutputDimension) =>
              (item.dimensionId || item.dimensionName) && item.subQuestions.length > 0
          ),
      };
    } catch {
      return { dimensions: [] };
    }
  }

  private async fallbackGeneratePlan(
    originalQuestion: string,
    dimensions: AnalysisDimension[],
    token?: string,
    apiKey?: string
  ): Promise<PlannedDimension[]> {
    const plans: PlannedDimension[] = [];

    for (const dimension of dimensions) {
      const values = await this.getDimensionValues(dimension, token, apiKey);
      if (!values.length) {
        logger.warn(tApp("analysis.dimension.dimension-engine.82", { name: dimension.name }));
        continue;
      }

      const subQuestions = values.map((value, index) =>
        this.createQuestionFromPlan({
          dimension,
          originalQuestion,
          dimensionValue: value,
          subQuestion: this.applyTemplate(
            dimension.subQuestionTemplate,
            originalQuestion,
            value,
            dimension.name
          ),
          index,
        })
      );

      plans.push({
        dimensionId: dimension.id,
        dimensionName: dimension.name,
        dimensionValue: values[0],
        subQuestions,
      });
    }

    return plans.filter((plan) => plan.subQuestions.length > 0);
  }

  private createQuestionFromPlan(params: {
    dimension: AnalysisDimension;
    originalQuestion: string;
    dimensionValue: string;
    subQuestion: string;
    index: number;
  }): DimensionalizedQuestion {
    const { dimension, originalQuestion, dimensionValue, subQuestion, index } = params;
    return {
      id: `${dimension.id}-${index + 1}`,
      dimensionId: dimension.id,
      dimensionName: dimension.name,
      dimensionValue,
      subQuestion,
      originalQuestion,
    };
  }

  private createSyntheticDimension(dimensionId: string, dimensionName: string): AnalysisDimension {
    const normalizedName = dimensionName.trim() || tApp("analysis.dimension.dimension-engine.83");
    const idSeed = dimensionId.trim() || `synthetic-${normalizedName.toLowerCase()}`;
    const normalizedId =
      idSeed.replace(/[.:/\\\s]+/g, "-").replace(/^-+|-+$/g, "") || "synthetic-dimension";

    return {
      id: normalizedId,
      agentId: "",
      name: normalizedName,
      dimensionType: "categorical",
      valueSource: "static",
      values: [normalizedName],
      subQuestionTemplate: "{question}",
      order: 0,
      isEnabled: true,
      createdAt: 0,
      updatedAt: 0,
    };
  }

  private async getDimensionValues(
    dimension: AnalysisDimension,
    token?: string,
    apiKey?: string
  ): Promise<string[]> {
    if (dimension.valueSource === "static") {
      return (dimension.values || []).filter(Boolean);
    }

    if (dimension.valueSource === "dataset_field" && dimension.datasetField) {
      return this.fetchFieldValues(dimension.datasetField, token, apiKey);
    }

    return [];
  }

  private async fetchFieldValues(
    fieldName: string,
    token?: string,
    apiKey?: string
  ): Promise<string[]> {
    try {
      const backendUrl = config.dataQuery.baseUrl;
      if (!backendUrl) {
        logger.warn(tApp("analysis.dimension.dimension-engine.84"));
        return [];
      }

      let className = "";
      let attrName = fieldName;

      const lastDotIndex = fieldName.lastIndexOf(".");
      if (lastDotIndex >= 0) {
        className = fieldName.slice(0, lastDotIndex);
        attrName = fieldName.slice(lastDotIndex + 1);
      }

      const url = `${backendUrl.replace(/\/$/, "")}/admin/queryDistinctAttrValue`;
      const body = {
        className,
        attrName,
        like: null,
        limit: 50,
      };

      logger.debug(tApp("analysis.dimension.dimension-engine.85", { value: className || tApp("analysis.dimension.dimension-engine.86"), attrName: attrName }));
      const resp = await backendPost("datasetSchema:distinctAttr", url, body, {
        token,
        apiKey,
        timeoutMs: 15000,
      });
      const json: any = JSON.parse(resp.text);
      const data = json?.data ?? json ?? {};

      if (Array.isArray(data)) {
        return data.map((item: any) => String(item)).filter(Boolean);
      }

      if (Array.isArray(data.values)) {
        return data.values.map((item: any) => String(item)).filter(Boolean);
      }

      logger.warn(tApp("analysis.dimension.dimension-engine.87", { fieldName: fieldName }), {
        type: typeof data,
        keys: data && typeof data === "object" ? Object.keys(data) : [],
      });
      return [];
    } catch (error) {
      logger.error(tApp("analysis.dimension.dimension-engine.88", { fieldName: fieldName }), error);
      return [];
    }
  }

  private applyTemplate(
    template: string,
    question: string,
    dimensionValue: string,
    dimensionName: string
  ): string {
    return template
      .replace(/{question}/g, question)
      .replace(/{dimensionValue}/g, dimensionValue)
      .replace(/{dimensionName}/g, dimensionName);
  }
}

export const dimensionEngine = new DimensionEngine();
