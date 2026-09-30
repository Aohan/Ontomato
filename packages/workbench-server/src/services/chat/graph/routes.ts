import { tApp } from "../../../i18n";
import { GraphState } from "./state";
import { createLogger } from "../../../logging/logger";
import { hasUsableDataReference } from "./utils/query-artifact-cache";

const logger = createLogger("routes");

export function routeAfterTaskPlanner(state: GraphState): string {
  const errors = state.errors || [];
  const taskPlannerError = errors.find((e) => e.node === "taskPlanner");
  if (taskPlannerError) {
    logger.warn(tApp("queryFixed.96", { v0: (taskPlannerError.message) }));
    return "response";
  }

  const result = state.taskPlannerResult;
  if (!result) {
    logger.error(tApp("queryFixed.97"));
    return "response";
  }

  if (result.status === "reply") {
    return "reply";
  }

  if (result.status === "knowledge") {
    return "knowledge";
  }

  if (result.status === "clarify") {
    return "response";
  }

  const plan = state.plan;

  if (!plan) {
    logger.error(tApp("queryFixed.98"));
    return "response";
  }

  if (!plan.nodes || plan.nodes.length === 0) {
    return "response";
  }

  const hasReadyData = hasUsableDataReference(state);

  // The analysis node depends on existing data; when the task planner did not explicitly schedule a query and there is no reusable data reference,
  // force query first, so analysis does not fail from missing usable data.
  if (plan.nodes.includes("analysis") && !plan.nodes.includes("query") && !hasReadyData) {
    return "query";
  }

  if (plan.nodes.length === 1 && plan.nodes[0] === "query") {
    return "query";
  }

  if (plan.nodes.includes("query")) {
    return "query";
  }

  if (plan.nodes.includes("analysis")) {
    return "analysis";
  }

  if (plan.nodes.includes("visualization")) {
    return "visualization";
  }

  return "response";
}

export function routeAfterQuery(state: GraphState): string {
  const plan = state.plan;

  if (!plan || !plan.nodes) {
    return "response";
  }

  if (plan.nodes.includes("analysis")) {
    return "analysis";
  }

  if (plan.nodes.includes("visualization")) {
    return "visualization";
  }

  return "response";
}

export function routeAfterAnalysis(state: GraphState): string {
  const plan = state.plan;

  if (!plan || !plan.nodes) {
    return "response";
  }

  if (plan.nodes.includes("visualization")) {
    return "visualization";
  }

  return "response";
}
