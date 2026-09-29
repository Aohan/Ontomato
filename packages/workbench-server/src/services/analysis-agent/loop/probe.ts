import type { AgentTool, AgentToolResult } from "../../../core/agent-loop/types";
import { buildHeaders, getApiConfig } from "../../../config/data-query-api";
import { config } from "../../../config/application";
import * as backend from "../../../utils/backend-client";
import type { DeepAnalysisArtifactStore } from "../task/artifacts";
import { tApp } from "../../../i18n";


const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 20;

function dataProbeCapabilityPrompt(): string {
  return [
  tApp("analysis.loop.probe.326"),
  tApp("analysis.loop.probe.327"),
  "",
  tApp("analysis.loop.probe.328"),
  tApp("analysis.loop.probe.329"),
  tApp("analysis.loop.probe.330"),
  "",
].join("\n");
}

interface LoopDataProbeDeps {
  token: string;
  apiKey: string;
  userId: string;
  locale?: string;
  classNames?: readonly string[];
  signal: AbortSignal;
  trajectory: Pick<DeepAnalysisArtifactStore, "start" | "settle">;
  dispatchId?: string;
}

/** Assembles the data-probing tool surface shared by supervisor and workers, with its prompt fragment. */
export function assembleLoopDataProbeCapability(deps: Omit<LoopDataProbeDeps, "dispatchId">) {
  return {
    prompt: dataProbeCapabilityPrompt(),
    supervisorTools: createLoopDataProbeTools(deps),
    createWorkerTools: (dispatchId: string) => createLoopDataProbeTools({ ...deps, dispatchId }),
  };
}

const textResult = (text: string): AgentToolResult => ({ content: [{ type: "text", text }] });
const errorMessage = (error: unknown): string => {
  if (error instanceof backend.AuthFailedError || error instanceof backend.BackendResponseError)
    return tApp("analysis.loop.probe.331", { status: String(error.status) });
  if (error instanceof backend.BackendUnavailableError && error.cause)
    return errorMessage(error.cause);
  return error instanceof Error ? error.message : String(error);
};
const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const isPositiveInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 1;

function parsePage(value: unknown): { number: number; size: number } {
  if (value === undefined) return { number: 1, size: DEFAULT_PAGE_SIZE };
  if (!isRecord(value)) throw new Error(tApp("analysis.loop.probe.332"));

  const number = value.number ?? 1;
  const size = value.size ?? DEFAULT_PAGE_SIZE;
  if (!isPositiveInteger(number)) throw new Error(tApp("analysis.loop.probe.333"));
  if (!isPositiveInteger(size)) throw new Error(tApp("analysis.loop.probe.334"));
  return { number, size: Math.min(size, MAX_PAGE_SIZE) };
}

async function fetchProbeData(
  deps: LoopDataProbeDeps,
  endpoint: string,
  body: Record<string, unknown> | undefined,
  signal: AbortSignal
): Promise<Record<string, unknown> & { data: unknown[] }> {
  const baseUrl = config.dataQuery.baseUrl.replace(/\/+$/, "");
  if (!baseUrl) throw new Error(tApp("analysis.loop.probe.335"));

  const options = {
    headers: buildHeaders(getApiConfig(), deps.token, deps.userId, deps.locale, deps.apiKey),
    signal,
    retries: 1,
  };
  const response = await (
    body
      ? backend.backendPost(endpoint, `${baseUrl}${endpoint}`, body, options)
      : backend.backendGet(endpoint, `${baseUrl}${endpoint}`, options)
  ).catch((error) => {
    throw signal.aborted ? signal.reason : error;
  });

  const payload: unknown = JSON.parse(response.text);
  if (!isRecord(payload) || payload.success !== true || !Array.isArray(payload.data)) {
    const detail = isRecord(payload) && typeof payload.message === "string" ? payload.message : "";
    throw new Error(detail || tApp("analysis.loop.probe.336"));
  }
  return payload as Record<string, unknown> & { data: unknown[] };
}

export function createLoopDataProbeTools(deps: LoopDataProbeDeps): AgentTool[] {
  const selectedClassNames = new Set(
    (deps.classNames || []).map((className) => className.trim()).filter(Boolean)
  );
  const dispatchFields = deps.dispatchId ? { dispatchId: deps.dispatchId } : {};
  const startProbe = (
    probeTool: "probe_classes" | "probe_class_data",
    probeArguments: Record<string, unknown>
  ) => deps.trajectory.start("probe", { probeTool, probeArguments, ...dispatchFields });

  const probeClasses: AgentTool = {
    name: "probe_classes",
    description: tApp("analysis.loop.probe.337"),
    parameters: { type: "object", properties: {} },
    async execute(_toolCallId, _params, signal) {
      const activityId = startProbe("probe_classes", {});
      const requestSignal = signal || deps.signal;
      try {
        requestSignal.throwIfAborted();
        const payload = await fetchProbeData(
          deps,
          "/data/getclassandcount",
          undefined,
          requestSignal
        );
        const classes = payload.data.filter((item) => {
          if (!isRecord(item) || typeof item.className !== "string") return false;
          return selectedClassNames.size === 0 || selectedClassNames.has(item.className);
        });
        deps.trajectory.settle(activityId, "completed");
        return textResult(
          tApp("analysis.loop.probe.338", { length: classes.length, stringify: JSON.stringify(classes) })
        );
      } catch (error: unknown) {
        const message = errorMessage(error);
        deps.trajectory.settle(activityId, requestSignal.aborted ? "cancelled" : "failed", {
          error: message,
        });
        if (requestSignal.aborted) throw error;
        return textResult(tApp("analysis.loop.probe.339", { message: message }));
      }
    },
  };

  const probeClassData: AgentTool = {
    name: "probe_class_data",
    description:
      tApp("analysis.loop.probe.340"),
    parameters: {
      type: "object",
      properties: {
        class_name: { type: "string", description: tApp("analysis.loop.probe.341") },
        page: {
          type: "object",
          description: tApp("analysis.loop.probe.342"),
          properties: {
            number: { type: "integer", minimum: 1, description: tApp("analysis.loop.probe.343") },
            size: { type: "integer", minimum: 1, description: tApp("analysis.loop.probe.344") },
          },
        },
      },
      required: ["class_name"],
    },
    async execute(_toolCallId, params, signal) {
      const className = typeof params.class_name === "string" ? params.class_name.trim() : "";
      let page: { number: number; size: number };
      try {
        if (!className) throw new Error(tApp("analysis.loop.probe.345"));
        page = parsePage(params.page);
      } catch (error: unknown) {
        const message = errorMessage(error);
        const activityId = startProbe("probe_class_data", params);
        deps.trajectory.settle(activityId, "failed", { error: message });
        return textResult(tApp("analysis.loop.probe.346", { message: message }));
      }

      const probeArguments = { class_name: className, page };
      const activityId = startProbe("probe_class_data", probeArguments);
      if (selectedClassNames.size > 0 && !selectedClassNames.has(className)) {
        const message = tApp("analysis.loop.probe.347", { className: className });
        deps.trajectory.settle(activityId, "failed", { error: message });
        return textResult(tApp("analysis.loop.probe.348", { message: message }));
      }

      const requestSignal = signal || deps.signal;
      try {
        requestSignal.throwIfAborted();
        const payload = await fetchProbeData(
          deps,
          "/data/getclassdatabypage",
          { classname: className, pagenum: page.number, pagecount: page.size },
          requestSignal
        );
        deps.trajectory.settle(activityId, "completed");
        const result = {
          rows: payload.data,
          totalCount: payload.total_count,
          totalPages: payload.total_page,
          currentPage: payload.cur_page,
        };
        return textResult(
          tApp("analysis.loop.probe.349", { className: className, number: page.number, size: page.size, stringify: JSON.stringify(result) })
        );
      } catch (error: unknown) {
        const message = errorMessage(error);
        deps.trajectory.settle(activityId, requestSignal.aborted ? "cancelled" : "failed", {
          error: message,
        });
        if (requestSignal.aborted) throw error;
        return textResult(tApp("analysis.loop.probe.346", { message: message }));
      }
    },
  };

  return [probeClasses, probeClassData];
}
