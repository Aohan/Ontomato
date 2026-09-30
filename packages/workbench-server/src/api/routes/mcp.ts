import { Request, Response, Router } from "express";
import { getAnalysisAgentMcpToolCatalog } from "./analysis-agent-mcp";
import { getOpsAgentMcpToolCatalog } from "./ops-agent-mcp";
import { buildMcpSystemToolsResponse, buildMcpToolsResponse } from "../../services/mcp/catalog";
import { asyncHandler } from "../utils/http";
import mcpServicesRouter from "./mcp-services";

const router: ReturnType<typeof Router> = Router();
router.use("/services", mcpServicesRouter);

router.get(
  "/system/tools",
  asyncHandler(async (req: Request, res: Response) => {
    const [analysisTools, opsTools] = await Promise.all([
      getAnalysisAgentMcpToolCatalog(),
      getOpsAgentMcpToolCatalog(),
    ]);
    const response = await buildMcpSystemToolsResponse(req, analysisTools, opsTools);
    res.json(response);
  })
);

router.get(
  "/tools",
  asyncHandler(async (_req: Request, res: Response) => {
    const response = await buildMcpToolsResponse(await getAnalysisAgentMcpToolCatalog());
    res.json(response);
  })
);

export default router;
