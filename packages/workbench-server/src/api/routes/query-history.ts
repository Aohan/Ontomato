import { Request, Response, Router } from "express";
import {
  getQueryHistoryDetail,
  getQueryHistoryList,
  getQueryHistoryTimeline,
} from "../../services/admin/query-history";
import { asyncHandler } from "../utils/http";

import { requireDomainId, type AuthenticatedRequest } from "../../utils/request-identity";

const router: ReturnType<typeof Router> = Router();

router.get(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const result = await getQueryHistoryList({
      userId: (req as AuthenticatedRequest).userId,
      domainId: requireDomainId(req as AuthenticatedRequest),
      status: req.query.status as string | undefined,
      objectClass: req.query.objectClass as string | undefined,
      startDate: req.query.startDate as string | undefined,
      endDate: req.query.endDate as string | undefined,
      limit: parseInt((req.query.limit as string) || "50", 10),
      offset: parseInt((req.query.offset as string) || "0", 10),
    });

    res.json({
      success: true,
      ...result,
    });
  })
);

router.get(
  "/:threadId/:requestSeq",
  asyncHandler(async (req: Request, res: Response) => {
    const { threadId, requestSeq } = req.params;
    const result = await getQueryHistoryDetail(
      threadId,
      parseInt(requestSeq, 10),
      (req as AuthenticatedRequest).userId,
      requireDomainId(req as AuthenticatedRequest)
    );

    res.json({
      success: true,
      ...result,
    });
  })
);

router.get(
  "/:threadId/:requestSeq/timeline",
  asyncHandler(async (req: Request, res: Response) => {
    const { threadId, requestSeq } = req.params;
    const result = await getQueryHistoryTimeline(
      threadId,
      parseInt(requestSeq, 10),
      (req as AuthenticatedRequest).userId,
      requireDomainId(req as AuthenticatedRequest)
    );

    res.json({
      success: true,
      ...result,
    });
  })
);

export default router;
