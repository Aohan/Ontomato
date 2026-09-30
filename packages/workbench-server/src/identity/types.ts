import type { Request, RequestHandler } from "express";
import type { RequestIdentity } from "@ontomato/contracts/identity";

/** Data engine online ticket verification result. Task attribution, MCP, and autotest never share this one return value. */
export interface VerifiedOnlineCredential {
  id: string;
  loginCode?: string | null;
  userName?: string | null;
  roles?: string[] | null;
  domainId?: string | null;
  domainName?: string | null;
}

export interface SkillResourceDomainResult {
  ok: true;
  domainId: string;
  token?: string;
  apiKey?: string;
}

export interface SkillResourceDomainFailure {
  ok: false;
  status: 401 | 403 | 502;
  code: string;
  error: string;
}

/**
 * Real identity differences between the editions. Shared routes only call members here and never branch on edition.
 * Calling before installation is an assembly error and never degrades into an anonymous principal.
 */
export interface WorkbenchIdentity {
  /** Enterprise verifies the ticket; OSS writes the fixed system/default. Proxies mounted before `/api` never pass through it. */
  authenticate: RequestHandler;
  /**
   * Called before every task run. Online entries pass in already-verified identity; offline tasks only have the token saved on the task row.
   * Enterprise: verified identity is compared with the task row directly, otherwise the token is verified again before comparing, and an attribution mismatch is rejected;
   * OSS keeps the userId/domainId on the task row, verifying no ticket and comparing nothing.
   */
  confirmTaskOwner(
    task: { userId: string; domainId: string; token?: string },
    verifiedIdentity?: Pick<RequestIdentity, "userId" | "domainId">
  ): Promise<void>;
  /** Enterprise verifies the tk and the domain must equal this run; OSS uses the domainId from run parameters, defaulting to default. */
  resolveAutotestActor(input: {
    token: string;
    domainId?: string | null;
  }): Promise<{ userId: string; domainId: string }>;
  /**
   * Enterprise: the API Key in tool parameters wins, then the API Key in the request, then the token.
   * OSS never reads these credentials and stays on the fixed system/default, nor writes the caller's API Key into the task.
   */
  resolveMcpCaller(
    req: Request,
    toolApiKey?: string
  ): Promise<{ userId: string; domainId: string; token?: string; apiKey?: string }>;
  /** `/api/skills/resources`. Enterprise verifies credentials first then requires the domain; OSS uses default directly. */
  resolveSkillResourceDomain(req: Request): Promise<SkillResourceDomainResult | SkillResourceDomainFailure>;
  /** Knowledge governance and skill writes. OSS allows all; enterprise goes through menu permissions. */
  requirePermission(keys: readonly string[]): RequestHandler;
  /** MCP service management routes. Their error copy differs from menu permissions, so they cannot merge into requirePermission. */
  guardMcpServiceManagement: RequestHandler;
  /** Diagnosis routes. Enterprise requires the domain first, then observer; OSS allows all. */
  observeAccess: RequestHandler;
  /** Verifies that the caller has access to diagnosis/observe capabilities. Enterprise requires domain and observer permission; OSS allows all. */
  assertObserveAccess(identity: { domainId?: string; token?: string; apiKey?: string }): Promise<void>;
  /**
   * Enterprise answers 403 when the domain is missing. OSS always returns default and never adopts the domain from request input,
   * preventing a self-declared request domain from splitting the single-domain storage.
   */
  requireDomainId(identity: { domainId?: string | null }): string;
}
