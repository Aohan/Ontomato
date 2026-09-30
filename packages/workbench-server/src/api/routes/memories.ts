import { Request, Response, Router } from "express";
import { getStore } from "../../infrastructure/connection";
import { asyncHandler } from "../utils/http";
import { requireDomainId, type AuthenticatedRequest } from "../../utils/request-identity";

const router: ReturnType<typeof Router> = Router();

router.delete(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const { userId } = req as AuthenticatedRequest;
    const storeInstance = getStore();

    if (storeInstance) {
      const namespace = ["memories", requireDomainId(req as AuthenticatedRequest), userId];
      const items = await storeInstance.search(namespace, { limit: 1000 });
      const count = items.length;
      await storeInstance.deleteByNamespace(namespace);
      res.json({ success: true, deletedCount: count });
    } else {
      res.json({ success: true, deletedCount: 0 });
    }
  })
);

export default router;
