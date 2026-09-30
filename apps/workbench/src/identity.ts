import type { RequestHandler } from "express";
import type { WorkbenchIdentity } from "@ontomato/workbench-server/identity/types";
import { environment } from "@ontomato/workbench-server/config/environment";
import { resolveLocale } from "@ontomato/workbench-server/i18n/index";
import { runWithLogContext } from "@ontomato/workbench-server/logging/log-context";
import { getLocaleFromRequest } from "@ontomato/workbench-server/api/utils/request";
import type { AuthenticatedRequest } from "@ontomato/workbench-server/utils/request-identity";

const pass: RequestHandler = (_req, _res, next) => {
  next();
};

export const ossIdentity: WorkbenchIdentity = {
  authenticate(req, _res, next) {
    const authReq = req as AuthenticatedRequest;
    authReq.userId = "system";
    authReq.userName = "system";
    authReq.roles = [];
    authReq.domainId = "default";
    authReq.token = typeof req.headers.tk === "string" ? req.headers.tk : "";
    authReq.apiKey =
      (typeof req.headers["x-api-key"] === "string" ? req.headers["x-api-key"] : "") ||
      environment.queryKey() ||
      "";
    authReq.locale = resolveLocale(getLocaleFromRequest(req));
    runWithLogContext(
      {
        domainId: authReq.domainId,
        token: authReq.token || undefined,
        apiKey: authReq.apiKey || undefined,
      },
      () => next()
    );
  },

  async confirmTaskOwner() {},

  async resolveAutotestActor(input) {
    return { userId: "system", domainId: input.domainId || "default" };
  },

  async resolveMcpCaller() {
    return { userId: "system", domainId: "default" };
  },

  async resolveSkillResourceDomain(req) {
    const token = typeof req.headers.tk === "string" ? req.headers.tk : undefined;
    const apiKey =
      (typeof req.headers["x-api-key"] === "string" ? req.headers["x-api-key"] : undefined) ||
      environment.queryKey() ||
      undefined;
    return { ok: true, domainId: "default", token, apiKey };
  },

  requirePermission() {
    return pass;
  },

  guardMcpServiceManagement: pass,

  observeAccess: pass,

  async assertObserveAccess() {},

  requireDomainId() {
    return "default";
  },
};
