import type { AbcBranchContext, BaseQueryOutput } from "./types";
import { executeAbcQuery, type AbcQueryConfig } from "../abc-tool";
import { t } from "../../../i18n";
import { runAbcHarnessBranch } from "./abc-harness-branch";

export async function runAbcBranch(ctx: AbcBranchContext): Promise<BaseQueryOutput | undefined> {
  const mode = ctx.abcQuestionMode;
  if (mode === "harness") {
    return runAbcHarnessBranch(ctx);
  }
  return runOriginalAbcBranch(ctx, mode === "no_tool_fixed");
}

async function runOriginalAbcBranch(
  ctx: AbcBranchContext,
  isV0: boolean
): Promise<BaseQueryOutput | undefined> {
  const { queryQuestion, token, userId, locale, pushEvent, thinking, setAbcThinking, apiKey } = ctx;
  thinking.ensureParallelStarted();
  thinking.set("running", t("query.status.decomposing"));
  thinking.log(t("query.thinking.abcDecomposing"));

  const abcConfig: AbcQueryConfig = {
    configurable: {
      token,
      userId,
      locale,
      apiKey,
      isV0,
      classNames: ctx.classNames,
      reportFallback: ctx.reportFallback,
      reportBackendLocation: ctx.reportBackendLocation,
      progressCallback: (event: any) => {
        if (event.type === "abc_thinking") {
          setAbcThinking(event.abcState);
          return;
        }

        pushEvent({
          type: event.type,
          node: "query",
          content: event,
          timestamp: Date.now(),
        });
      },
    },
    signal: ctx.signal,
  };

  const abcResult = await executeAbcQuery(queryQuestion, abcConfig);

  if (!abcResult.success) {
    setAbcThinking(abcResult.thinkingState);
    throw new Error(abcResult.rawError || abcResult.error || t("query.error.unknownError"));
  }

  const datasets = abcResult.datasets || [];
  const content = abcResult.content || "";
  setAbcThinking(abcResult.thinkingState);
  const sessionId = abcResult.sessionId;
  const nodeIds = Array.isArray(abcResult.nodeIds)
    ? abcResult.nodeIds.map((item) => String(item)).filter(Boolean)
    : [];

  thinking.set("success", t("query.status.completed"));
  thinking.log(t("query.thinking.abcCompleted", { count: datasets.length }));

  return {
    content,
    datasets,
    sessionId,
    backendNodeId: abcResult.backendNodeId,
    nodeIds,
    subQuestions: abcResult.subQuestions,
    abcDsls: abcResult.abcDsls,
    abcCodes: abcResult.abcCodes,
    replayPlan: abcResult.replayPlan,
  };
}
