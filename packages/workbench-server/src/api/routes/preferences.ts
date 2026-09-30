import { Request, Response, Router } from "express";
import { getStore } from "../../infrastructure/connection";
import type { AuthenticatedRequest } from "../../utils/request-identity";
import { asyncHandler } from "../utils/http";

const router: ReturnType<typeof Router> = Router();

router.get(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const { userId } = req as AuthenticatedRequest;
    const storeInstance = getStore();
    if (storeInstance) {
      const prefs = await storeInstance.search(["preferences", userId], { limit: 100 });
      res.json(prefs);
    } else {
      res.json([]);
    }
  })
);

export default router;
