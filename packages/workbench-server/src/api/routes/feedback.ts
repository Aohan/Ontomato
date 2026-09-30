import type { FeedbackRating, FeedbackSourceType } from "@ontomato/contracts/feedback";
import { Request, Response, Router } from "express";
import { t } from "../../i18n";
import type { AuthenticatedRequest } from "../../utils/request-identity";
import { deleteFeedback, listFeedback, saveFeedback } from "../../services/admin/feedback-store";
import { asyncHandler } from "../utils/http";
import { HttpError } from "../../utils/errors";
const router: ReturnType<typeof Router> = Router();

function normalizeSourceType(value: unknown): FeedbackSourceType | null {
  return value === "qa" || value === "analysis_task" ? value : null;
}

function normalizeRating(value: unknown): FeedbackRating | null {
  return value === "like" || value === "dislike" ? value : null;
}

function normalizeRequestSeq(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value !== "string") return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : undefined;
}

router.post(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const body = req.body || {};
    const sourceType = normalizeSourceType(body.sourceType || body.source);
    const rating = normalizeRating(body.rating);
    const targetId = String(body.targetId || body.responseId || "").trim();
    const identity = req as AuthenticatedRequest;
    const userId = identity.userId;
    const userName = identity.userName;

    if (!sourceType || !targetId || !rating) {
      throw new HttpError(400, "sourceType, targetId and rating are required");
    }

    if (rating === "dislike" && !String(body.feedbackText || body.comment || "").trim()) {
      throw new HttpError(400, "feedbackText is required for dislike");
    }

    const record = await saveFeedback({
      sourceType,
      targetId,
      threadId: typeof body.threadId === "string" ? body.threadId : undefined,
      requestSeq: Number.isInteger(body.requestSeq) ? body.requestSeq : undefined,
      taskId: typeof body.taskId === "string" ? body.taskId : undefined,
      rating,
      userId,
      domainId: identity.domainId,
      userName,
      userInput: typeof body.userInput === "string" ? body.userInput : undefined,
      assistantOutput: typeof body.assistantOutput === "string" ? body.assistantOutput : undefined,
      feedbackText:
        typeof body.feedbackText === "string"
          ? body.feedbackText
          : typeof body.comment === "string"
            ? body.comment
            : undefined,
      metadata: body.metadata,
    });

    const message = t("api.feedbackSubmitted");
    res.json({ success: true, message, data: record });
  })
);

router.delete(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const sourceType = normalizeSourceType(req.query.sourceType);
    const targetId = String(req.query.targetId || "").trim();
    const turnKey = String(req.query.turnKey || "").trim();

    if (!sourceType || !targetId) {
      throw new HttpError(400, "sourceType and targetId are required");
    }

    const deleted = await deleteFeedback({
      sourceType,
      targetId,
      threadId: typeof req.query.threadId === "string" ? req.query.threadId : undefined,
      requestSeq: normalizeRequestSeq(req.query.requestSeq),
      taskId: typeof req.query.taskId === "string" ? req.query.taskId : undefined,
      metadata: turnKey ? { turnKey } : undefined,
    });

    res.json({ success: true, data: { deleted } });
  })
);

router.get(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const sourceType = normalizeSourceType(req.query.sourceType);
    const rating = normalizeRating(req.query.rating);
    const data = await listFeedback({
      domainId: (req as AuthenticatedRequest).domainId,
      sourceType: sourceType || undefined,
      rating: rating || undefined,
      userId: typeof req.query.userId === "string" ? req.query.userId : undefined,
      threadId: typeof req.query.threadId === "string" ? req.query.threadId : undefined,
      taskId: typeof req.query.taskId === "string" ? req.query.taskId : undefined,
      targetIds:
        typeof req.query.targetIds === "string"
          ? req.query.targetIds
              .split(",")
              .map((item) => item.trim())
              .filter(Boolean)
          : undefined,
      keyword: typeof req.query.keyword === "string" ? req.query.keyword : undefined,
      limit: Number(req.query.limit || 20),
      offset: Number(req.query.offset || 0),
    });
    res.json({ success: true, data });
  })
);

router.get(
  "/state",
  asyncHandler(async (req: Request, res: Response) => {
    const sourceType = normalizeSourceType(req.query.sourceType);
    const identity = req as AuthenticatedRequest;
    const userId = identity.userId;
    const data = await listFeedback({
      domainId: identity.domainId,
      sourceType: sourceType || undefined,
      userId,
      threadId: typeof req.query.threadId === "string" ? req.query.threadId : undefined,
      taskId: typeof req.query.taskId === "string" ? req.query.taskId : undefined,
      targetIds:
        typeof req.query.targetIds === "string"
          ? req.query.targetIds
              .split(",")
              .map((item) => item.trim())
              .filter(Boolean)
          : undefined,
      limit: Number(req.query.limit || 500),
      offset: 0,
    });
    res.json({ success: true, data });
  })
);

export default router;
