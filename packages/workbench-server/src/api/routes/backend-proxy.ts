import { Request, Response, Router } from "express";
import { config } from "../../config/application";
import { proxyUpstream } from "../utils/proxy";

const router: ReturnType<typeof Router> = Router();

router.use("/", (req: Request, res: Response) => {
  proxyUpstream(req, res, config.dataQuery.baseUrl, req.path);
});

export default router;
