import { Router, Request, Response } from "express";
import {
  getCardById,
  updateCardStatus,
  updateCardBusinessDescription,
  deleteCard,
  getPublishedCards,
} from "../../services/analysis-agent/hot-card/analysis-report-hot-cards";
import { listCardSummariesWithAgentNames } from "../../services/analysis-agent/hot-card/card-summary";
import { createLogger } from "../../logging/logger";
import { t, tApp } from "../../i18n";
import type { AuthenticatedRequest } from "../../utils/request-identity";
import { asyncHandler } from "../utils/http";
import { HttpError } from "../../utils/errors";

const logger = createLogger("api:analysis-reports");
const router: ReturnType<typeof Router> = Router();

/**
 * GET /api/analysis-reports/cards
 * Lists analysis report hot cards (with status filtering)
 */
router.get(
  "/cards",
  asyncHandler(async (req: Request, res: Response) => {
    const status = req.query.status as string | undefined;
    const domainId = (req as AuthenticatedRequest).domainId;
    const summary = await listCardSummariesWithAgentNames(domainId, status);
    res.json({ success: true, data: summary });
  })
);

/**
 * GET /api/analysis-reports/cards/published
 * Lists published cards (consumed by the query node's hot matching)
 */
router.get(
  "/cards/published",
  asyncHandler(async (req: Request, res: Response) => {
    const cards = await getPublishedCards({ domainId: (req as AuthenticatedRequest).domainId });
    res.json({ success: true, data: cards });
  })
);

/**
 * GET /api/analysis-reports/cards/:id
 * Gets one card's details
 */
router.get(
  "/cards/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const card = await getCardById(req.params.id, (req as AuthenticatedRequest).domainId);
    if (!card) {
      throw new HttpError(404, t("api.cardNotFound"));
    }
    res.json({ success: true, data: card });
  })
);

/**
 * PUT /api/analysis-reports/cards/:id/status
 * Sets a card's status (approval action)
 */
router.put(
  "/cards/:id/status",
  asyncHandler(async (req: Request, res: Response) => {
    const { status } = req.body;
    if (!status || !["PENDING_REVIEW", "PUBLISHED", "UNUSED"].includes(status)) {
      throw new HttpError(400, t("api.invalidStatusValue"));
    }
    const card = await updateCardStatus(
      req.params.id,
      status,
      (req as AuthenticatedRequest).domainId
    );
    if (!card) {
      throw new HttpError(404, t("api.cardNotFound"));
    }
    logger.info(tApp("analysis.log.reports.cardUpdated", { id: req.params.id, status }));
    res.json({ success: true, data: card });
  })
);

/**
 * PUT /api/analysis-reports/cards/:id/business-description
 * Sets a card's business description
 */
router.put(
  "/cards/:id/business-description",
  asyncHandler(async (req: Request, res: Response) => {
    const { businessDescription } = req.body;
    if (typeof businessDescription !== "string") {
      throw new HttpError(400, t("api.businessDescriptionMustBeString"));
    }
    const card = await updateCardBusinessDescription(
      req.params.id,
      businessDescription,
      (req as AuthenticatedRequest).domainId
    );
    if (!card) {
      throw new HttpError(404, t("api.cardNotFound"));
    }
    res.json({ success: true, data: card });
  })
);

/**
 * DELETE /api/analysis-reports/cards/:id
 * Deletes a card
 */
router.delete(
  "/cards/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const deleted = await deleteCard(req.params.id, (req as AuthenticatedRequest).domainId);
    if (!deleted) {
      throw new HttpError(404, t("api.cardNotFound"));
    }
    res.json({ success: true });
  })
);

export default router;
