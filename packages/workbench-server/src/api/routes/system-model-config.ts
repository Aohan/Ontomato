import type { HttpResponse } from "@ontomato/contracts/http";
import type { SystemModelConfig } from "@ontomato/contracts/system-model";
import { NextFunction, Request, Response, Router } from "express";
import {
  getSystemModelConfig,
  saveSystemModelConfig,
  SystemModelConfigError,
} from "../../config/system-model";
import { createLogger } from "../../logging/logger";
import { t, tApp } from "../../i18n";
import type { AuthenticatedRequest } from "../../utils/request-identity";
import { asyncHandler, sendError } from "../utils/http";
import { HttpError } from "../../utils/errors";

const router: ReturnType<typeof Router> = Router();
const logger = createLogger("api:system-model-config");

function requireDomain(req: Request, res: Response, next: NextFunction): void {
  if (!(req as AuthenticatedRequest).domainId) {
    sendError(res, new HttpError(403, tApp("foundation.domain.required")));
    return;
  }
  next();
}

router.use(requireDomain);

router.get(
  "/",
  asyncHandler(
    async (req: Request, res: Response<HttpResponse<SystemModelConfig>>) => {
      const domainId = (req as AuthenticatedRequest).domainId!;
      const config = getSystemModelConfig(domainId);
      res.json({ success: true, data: config });
    }
  )
);

router.post(
  "/save",
  asyncHandler(
    async (req: Request, res: Response<HttpResponse<SystemModelConfig>>) => {
      try {
        const domainId = (req as AuthenticatedRequest).domainId!;
        const config = saveSystemModelConfig(domainId, req.body || {});
        res.json({ success: true, data: config });
      } catch (error) {
        logger.error(tApp("foundation.systemModel.saveFailed"), error);
        const status = error instanceof SystemModelConfigError ? 400 : 500;
        const message =
          error instanceof Error && error.message ? error.message : t("api.saveConfigFailed");
        throw new HttpError(status, message);
      }
    }
  )
);

export default router;
