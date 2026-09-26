import type { HttpResponse } from "@ontomato/contracts/http";
import type { SystemModelConfig, SystemModelConfigResponse } from "@ontomato/contracts/system-model";
import type { SystemModelTestEvent } from "@ontomato/contracts/system-model";
import { NextFunction, Request, Response, Router } from "express";
import {
  getSystemModelConfig,
  saveSystemModelConfig,
  hasCustomConfig,
  SystemModelConfigError,
} from "../../config/system-model";
import { CustomRequestParametersError } from "../../config/custom-request-parameters";
import { runSystemModelProbe } from "../../services/admin/system-model-config";
import { createLogger } from "../../logging/logger";
import { writeSseError } from "../../utils/sse";
import { t, tApp } from "../../i18n";
import type { AuthenticatedRequest } from "../../utils/request-identity";
import { rateLimiter } from "../middleware/rate-limit";
import { asyncHandler, sendError } from "../utils/http";
import { HttpError } from "../../utils/errors";

const router: ReturnType<typeof Router> = Router();
const logger = createLogger("api:system-model-config");
const modelTestRateLimiter = rateLimiter({ maxRequests: 30, windowSeconds: 60 });

function requireDomain(req: Request, res: Response, next: NextFunction): void {
  if (!(req as AuthenticatedRequest).domainId) {
    sendError(res, new HttpError(403, tApp("foundation.domain.required")));
    return;
  }
  next();
}

router.use(requireDomain);

function toConfigResponse(config: SystemModelConfig, domainId: string): SystemModelConfigResponse {
  // Settings page is auth-gated: the management API returns real keys and the page controls visibility.
  return {
    ...config,
    hasCustomConfig: hasCustomConfig(domainId),
  };
}

router.get(
  "/",
  asyncHandler(async (req: Request, res: Response<HttpResponse<SystemModelConfigResponse>>) => {
    const domainId = (req as AuthenticatedRequest).domainId!;
    const config = getSystemModelConfig(domainId);
    res.json({ success: true, data: toConfigResponse(config, domainId) });
  })
);

router.post(
  "/save",
  asyncHandler(async (req: Request, res: Response<HttpResponse<SystemModelConfigResponse>>) => {
    try {
      const domainId = (req as AuthenticatedRequest).domainId!;
      const body = req.body || {};

      const config = saveSystemModelConfig(domainId, {
        models: body.models,
        agents: body.agents,
        abcQuestionMode: body.abcQuestionMode,
        queryTimeoutSeconds: body.queryTimeoutSeconds,
      });
      res.json({ success: true, data: toConfigResponse(config, domainId) });
    } catch (error) {
      logger.error(tApp("foundation.systemModel.saveFailed"), error);
      const status =
        error instanceof CustomRequestParametersError || error instanceof SystemModelConfigError
          ? 400
          : 500;
      const message =
        error instanceof Error && error.message ? error.message : t("api.saveConfigFailed");
      throw new HttpError(status, message);
    }
  })
);

router.post(
  "/test",
  modelTestRateLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const body = req.body || {};
      const resolvedModelName = await runSystemModelProbe(
        body,
        () => {
          res.setHeader("Content-Type", "text/event-stream");
          res.setHeader("Cache-Control", "no-cache");
          res.setHeader("Connection", "keep-alive");
          res.flushHeaders();
        },
        (content) => {
          res.write(`data: ${JSON.stringify({ content } satisfies SystemModelTestEvent)}\n\n`);
        }
      );

      res.write(
        `data: ${JSON.stringify({ content: "", done: true, model: resolvedModelName } satisfies SystemModelTestEvent)}\n\n`
      );
      res.end();
    } catch (error) {
      logger.error(tApp("foundation.systemModel.testFailed"), error);
      const message =
        error instanceof Error && error.message ? error.message : t("api.modelTestFailed");
      if (res.headersSent) {
        writeSseError(res, message);
        res.end();
        return;
      }
      const status =
        error instanceof CustomRequestParametersError || error instanceof SystemModelConfigError
          ? 400
          : 500;
      throw new HttpError(status, message);
    }
  })
);

export default router;
