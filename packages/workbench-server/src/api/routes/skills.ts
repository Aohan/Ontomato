import { NextFunction, Request, Response, Router } from "express";
import { z } from "zod";
import multer from "multer";
import { skillManager } from "../../services/skills/skill-manager";
import { skillRuntime } from "../../core/skills/index";
import {
  getSkillCombinationError,
  InvalidSkillPackageError,
  SkillCategorySchema,
  SkillIdSchema,
  SkillTypeSchema,
} from "../../core/skills/manifest";
import { t, tApp } from "../../i18n";
import { validateBody } from "../middleware";
import { requirePermission } from "../../identity/installed";
import type { AuthenticatedRequest } from "../../utils/request-identity";
import { asyncHandler, sendError } from "../utils/http";
import { HttpError } from "../../utils/errors";
const router: ReturnType<typeof Router> = Router();
const upload = multer({ storage: multer.memoryStorage() });
const requireSkillAdmin = requirePermission(["skill-management"]);

function requireDomain(req: Request, res: Response, next: NextFunction): void {
  if (!(req as AuthenticatedRequest).domainId) {
    sendError(res, new HttpError(403, tApp("foundation.domain.required")));
    return;
  }
  next();
}

const CreateSkillSchema = z
  .object({
    id: SkillIdSchema,
    type: SkillTypeSchema,
    category: SkillCategorySchema,
    title: z.string().optional(),
    description: z.string({ required_error: tApp("foundation.skill.description") }).trim().min(1, tApp("foundation.skill.description")),
    tags: z.array(z.string()).optional(),
    version: z.string().optional(),
    timeout: z.number().optional(),
    outputType: z.enum(["text", "html", "json"]).optional(),
    scriptCode: z.string().optional(),
    skillContent: z.string().optional(),
  })
  .superRefine((skill, ctx) => {
    const error = getSkillCombinationError(skill.type, skill.category);
    if (error) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["type"], message: error });
    }
  });

const UpdateSkillSchema = z.object({
  title: z.string().optional(),
  description: z.string().trim().min(1, tApp("foundation.skill.description")).optional(),
  tags: z.array(z.string()).optional(),
  version: z.string().optional(),
  timeout: z.number().optional(),
  outputType: z.enum(["text", "html", "json"]).optional(),
  scriptCode: z.string().optional(),
  skillContent: z.string().optional(),
});

const DebugSkillSchema = z.object({
  input: z.record(z.unknown()).optional().default({}),
});

// Read-only endpoints — authenticated by the shared /api boundary.
router.get(
  "/metrics",
  asyncHandler(async (req: Request, res: Response) => {
    const domainId = (req as AuthenticatedRequest).domainId;
    if (domainId) await skillRuntime.initialize(domainId);
    const metrics = domainId
      ? skillRuntime.getAllMetrics(domainId)
      : { skills: {}, updatedAt: Date.now() };
    res.json({ success: true, metrics });
  })
);

router.get(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const domainId = (req as AuthenticatedRequest).domainId;
    const skills = domainId ? await skillManager.getAllSkills(domainId) : [];
    res.json({ success: true, skills });
  })
);

router.get(
  "/search",
  asyncHandler(async (req: Request, res: Response) => {
    const domainId = (req as AuthenticatedRequest).domainId;
    const query = String(req.query.q || "").trim();
    const skills = domainId ? await skillManager.searchSkills(domainId, query) : [];
    res.json({ success: true, skills });
  })
);

router.get(
  "/:id/references",
  asyncHandler(async (req: Request, res: Response) => {
    const domainId = (req as AuthenticatedRequest).domainId;
    const affectedAgents = domainId
      ? await skillManager.getSkillReferences(domainId, req.params.id)
      : [];
    res.json({ success: true, affectedAgents });
  })
);

router.get(
  "/:id/script",
  asyncHandler(async (req: Request, res: Response) => {
    const domainId = (req as AuthenticatedRequest).domainId;
    const scriptCode = domainId ? await skillManager.getSkillScript(domainId, req.params.id) : null;
    res.json({ success: true, scriptCode });
  })
);

router.get(
  "/:id/content",
  asyncHandler(async (req: Request, res: Response) => {
    const domainId = (req as AuthenticatedRequest).domainId;
    const skillContent = domainId
      ? await skillManager.getSkillContent(domainId, req.params.id)
      : null;
    res.json({ success: true, skillContent });
  })
);

router.get(
  "/:id/export",
  asyncHandler(async (req: Request, res: Response) => {
    const domainId = (req as AuthenticatedRequest).domainId;
    if (!domainId) {
      res.status(204).end();
      return;
    }
    const zipBuffer = await skillManager.exportSkill(domainId, req.params.id);
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${req.params.id}.zip"`);
    res.send(zipBuffer);
  })
);

// Write endpoints — authenticated by the shared /api boundary and require a domain.
router.put(
  "/:id/toggle",
  requireDomain,
  requireSkillAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const result = await skillManager.toggleSkill(
      (req as AuthenticatedRequest).domainId!,
      req.params.id
    );
    res.json({ success: true, enabled: result.enabled });
  })
);

router.delete(
  "/:id",
  requireDomain,
  requireSkillAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const result = await skillManager.deleteSkill(
      (req as AuthenticatedRequest).domainId!,
      req.params.id
    );
    res.json({ success: true, ...result });
  })
);

router.post(
  "/",
  requireDomain,
  requireSkillAdmin,
  validateBody(CreateSkillSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const body = req.body as z.infer<typeof CreateSkillSchema>;
    const skill = await skillManager.createSkill(
      (req as AuthenticatedRequest).domainId!,
      body.id,
      body.type,
      body.category,
      {
        title: body.title,
        description: body.description,
        tags: body.tags,
        version: body.version,
        timeout: body.timeout,
        outputType: body.outputType,
        scriptCode: body.scriptCode,
        skillContent: body.skillContent,
      }
    );
    res.json({ success: true, skill });
  })
);

router.put(
  "/:id",
  requireDomain,
  requireSkillAdmin,
  validateBody(UpdateSkillSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const body = req.body as z.infer<typeof UpdateSkillSchema>;
    const skill = await skillManager.updateSkill(
      (req as AuthenticatedRequest).domainId!,
      req.params.id,
      body
    );
    res.json({ success: true, skill });
  })
);

router.post(
  "/import",
  requireDomain,
  requireSkillAdmin,
  upload.single("file"),
  asyncHandler(async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        throw new HttpError(400, t("api.noFileUploaded"));
      }
      if (!req.file.originalname.endsWith(".zip")) {
        throw new HttpError(400, t("api.onlyZipSupported"));
      }
      const overwrite =
        req.query.overwrite === "true" || (req.body && (req.body as any).overwrite === "true");
      const skill = await skillManager.importSkill(
        (req as AuthenticatedRequest).domainId!,
        req.file.buffer,
        overwrite
      );
      res.json({ success: true, skill });
    } catch (error: unknown) {
      if (error && typeof error === "object" && "code" in error && error.code === "SKILL_EXISTS") {
        const skillId = "skillId" in error ? String(error.skillId) : "";
        const message = error instanceof Error ? error.message : String(error);
        throw new HttpError(409, message, "SKILL_EXISTS", { skillId });
      }
      if (error instanceof InvalidSkillPackageError) {
        throw new HttpError(error.status, error.message, error.code);
      }
      throw error;
    }
  })
);

router.post(
  "/:id/debug",
  requireDomain,
  requireSkillAdmin,
  validateBody(DebugSkillSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const body = req.body as z.infer<typeof DebugSkillSchema>;
    const result = await skillManager.debugSkill(
      (req as AuthenticatedRequest).domainId!,
      req.params.id,
      body.input
    );
    res.json({ success: true, result });
  })
);

export default router;
