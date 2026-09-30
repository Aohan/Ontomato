import { guardMcpServiceManagement } from "../../identity/installed";
import { Router, type Request, type Response } from "express";
import { validateBody } from "../middleware/validate";
import type { AuthenticatedRequest } from "../../utils/request-identity";
import {
  McpServiceConfigSchema,
  listMcpServiceConfigs,
  saveMcpServiceConfig,
  deleteMcpServiceConfig,
} from "../../services/mcp/service-config";
import { listMcpTools } from "../../services/mcp";

const router: ReturnType<typeof Router> = Router();
const domain = (req: Request) => (req as AuthenticatedRequest).domainId!;

function fail(res: Response, error: unknown): void {
  const duplicate = error && typeof error === "object" && "code" in error && error.code === "23505";
  res.status(duplicate ? 409 : 500).json({
    success: false,
    code: duplicate ? "MCP_NAME_EXISTS" : "MCP_CONFIG_FAILED",
    error: duplicate ? "MCP service name already exists" : "Unable to access MCP configuration",
  });
}

router.use((req, res, next) => {
  if (!domain(req)) {
    res.status(403).json({ success: false, error: "Domain required" });
    return;
  }
  next();
});

// Agent selection only needs names; connection credentials remain in the management boundary.
router.get("/names", async (req, res) => {
  try {
    const services = await listMcpServiceConfigs(domain(req));
    res.json({ names: services.map((service) => service.name) });
  } catch (error) {
    fail(res, error);
  }
});

router.use(guardMcpServiceManagement);

router.get("/", async (req, res) => {
  try {
    res.json({ services: await listMcpServiceConfigs(domain(req)) });
  } catch (error) {
    fail(res, error);
  }
});

router.post("/", validateBody(McpServiceConfigSchema), async (req, res) => {
  try {
    await saveMcpServiceConfig(domain(req), req.body);
    res.status(201).json({ success: true });
  } catch (error) {
    fail(res, error);
  }
});

router.put("/:name", validateBody(McpServiceConfigSchema), async (req, res) => {
  try {
    const saved = await saveMcpServiceConfig(domain(req), req.body, req.params.name);
    res.status(saved ? 200 : 404).json({ success: saved });
  } catch (error) {
    fail(res, error);
  }
});

router.delete("/:name", async (req, res) => {
  try {
    const deleted = await deleteMcpServiceConfig(domain(req), req.params.name);
    res.status(deleted ? 200 : 404).json({ success: deleted });
  } catch (error) {
    fail(res, error);
  }
});

router.get("/:name/tools", async (req, res) => {
  const controller = new AbortController();
  res.on("close", () => controller.abort());
  try {
    const service = (await listMcpServiceConfigs(domain(req))).find(
      (s) => s.name === req.params.name
    );
    if (!service) {
      res.status(404).json({ success: false, error: "MCP service not found" });
      return;
    }
    res.json({ tools: await listMcpTools(service.url, service.headers, controller.signal) });
  } catch {
    if (!controller.signal.aborted) {
      res.status(502).json({ success: false, error: "Unable to connect to MCP service" });
    }
  }
});

export default router;
