import { Router } from "express";
import type { AuthenticatedRequest } from "../../utils/request-identity";
import {
  getWorkbenchAppearance,
  saveWorkbenchAppearance,
  workbenchAppearanceSchema,
} from "../../config/workbench-appearance";
import { createLogger } from "../../logging/logger";

const router: ReturnType<typeof Router> = Router();
const logger = createLogger("workbench-appearance");

router.use((req, res, next) => {
  if (!(req as AuthenticatedRequest).domainId) {
    res.status(403).json({ code: "DOMAIN_REQUIRED", error: "appearance.domainRequired" });
    return;
  }
  next();
});

router.get("/", async (req, res) => {
  try {
    res.json(await getWorkbenchAppearance((req as AuthenticatedRequest).domainId!));
  } catch (error) {
    logger.error("Failed to load workbench appearance", error);
    res.status(500).json({ code: "APPEARANCE_LOAD_FAILED", error: "appearance.loadFailed" });
  }
});

router.post("/", async (req, res) => {
  const parsed = workbenchAppearanceSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ code: "INVALID_APPEARANCE", error: "appearance.invalid" });
    return;
  }
  try {
    await saveWorkbenchAppearance((req as AuthenticatedRequest).domainId!, parsed.data);
    res.json(parsed.data);
  } catch (error) {
    logger.error("Failed to save workbench appearance", error);
    res.status(500).json({ code: "APPEARANCE_SAVE_FAILED", error: "appearance.saveFailed" });
  }
});

export default router;
