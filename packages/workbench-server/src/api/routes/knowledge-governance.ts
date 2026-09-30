import { Router } from "express";
import { z } from "zod";
import { governanceMessageInputSchema } from "@ontomato/contracts/knowledge-governance";
import { governanceRuntime } from "../../services/knowledge-governance/runtime";
import {
  governanceStore,
  publicGovernanceSession,
} from "../../services/knowledge-governance/store";
import { readGovernanceSource } from "../../services/knowledge-governance/tools";
import { requireDomainId, type AuthenticatedRequest } from "../../utils/request-identity";
import { HttpError } from "../../utils/errors";
import { requirePermission } from "../../identity/installed";
import { asyncHandler } from "../utils/http";

const router: ReturnType<typeof Router> = Router();
router.use(requirePermission(["business-knowledge"]));
function context(req: AuthenticatedRequest) {
  const domainId = requireDomainId(req);
  return {
    owner: { domainId, userId: req.userId },
    credentials: { domainId, token: req.token, apiKey: req.apiKey },
    locale: req.locale,
  };
}
function sessionId(value: string) {
  const result = z.string().uuid().safeParse(value);
  if (!result.success) throw new HttpError(400, "Invalid session id");
  return result.data;
}
router.get(
  "/",
  asyncHandler(async (req, res) => {
    res.json(await governanceStore.list(context(req as AuthenticatedRequest).owner));
  })
);
router.post(
  "/",
  asyncHandler(async (req, res) => {
    const { owner, credentials, locale } = context(req as AuthenticatedRequest);
    res.status(201).json(await governanceRuntime.start(owner, credentials, locale));
  })
);
router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    res.json(
      publicGovernanceSession(
        await governanceStore.get(
          sessionId(req.params.id!),
          context(req as AuthenticatedRequest).owner
        )
      )
    );
  })
);
router.post(
  "/:id/messages",
  asyncHandler(async (req, res) => {
    const input = governanceMessageInputSchema.safeParse(req.body);
    if (!input.success)
      throw new HttpError(400, "A non-empty message up to 20000 characters is required");
    const { owner, credentials, locale } = context(req as AuthenticatedRequest);
    res.json(
      await governanceRuntime.respond(
        sessionId(req.params.id!),
        owner,
        credentials,
        locale,
        input.data.message
      )
    );
  })
);
router.post(
  "/:id/stop",
  asyncHandler(async (req, res) => {
    res.json(
      await governanceRuntime.stop(
        sessionId(req.params.id!),
        context(req as AuthenticatedRequest).owner
      )
    );
  })
);
router.get(
  "/:id/sources/:sourceId",
  asyncHandler(async (req, res) => {
    const { owner, credentials } = context(req as AuthenticatedRequest);
    const offset = z.coerce
      .number()
      .int()
      .nonnegative()
      .safeParse(req.query.offset || 0);
    if (!offset.success) throw new HttpError(400, "Invalid source offset");
    const record = await governanceStore.get(sessionId(req.params.id!), owner);
    res.json(await readGovernanceSource(record, credentials, req.params.sourceId!, offset.data));
  })
);
export default router;
