import type { Request, RequestHandler } from "express";
import type { RequestIdentity } from "@ontomato/contracts/identity";

/** DataRAG 在线验票结果。任务归属、MCP 和自动测试不共用这一个返回值。 */
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
 * 两版真实身份差异。共享路由只调用这里的成员，不判断版本。
 * 未安装就调用是装配错误，不会落到匿名主体。
 */
export interface WorkbenchIdentity {
  /** 企业验票；OSS 写入固定 system/default。挂在 `/api` 之前的代理不经过它。 */
  authenticate: RequestHandler;
  /**
   * 每次任务运行前调用。在线入口传入已验身份，离线任务只有任务行上保存的 token。
   * 企业：已验身份直接与任务行比较，否则用 token 再验后比较，归属不符即拒绝；
   * OSS 沿用任务行上的 userId/domainId，不验票也不比较。
   */
  confirmTaskOwner(
    task: { userId: string; domainId: string; token?: string },
    verifiedIdentity?: Pick<RequestIdentity, "userId" | "domainId">
  ): Promise<void>;
  /** 企业验 tk 且域必须等于本次运行；OSS 用运行参数里的 domainId，缺省 default。 */
  resolveAutotestActor(input: {
    token: string;
    domainId?: string | null;
  }): Promise<{ userId: string; domainId: string }>;
  /**
   * 重采产物。调用方已经要求 tk 非空。
   * 企业验这段 token 的域；OSS 不解释 token，域用 default。
   */
  resolveCollectDomain(token: string, signal?: AbortSignal): Promise<string>;
  /**
   * 企业：工具参数里的 API Key 优先，其次请求里的 API Key，最后才是 token。
   * OSS 不读这些凭据，固定 system/default，也不把调用方 API Key 写入任务。
   */
  resolveMcpCaller(
    req: Request,
    toolApiKey?: string
  ): Promise<{ userId: string; domainId: string; token?: string; apiKey?: string }>;
  /** `/api/skills/resources`。企业先验凭据再要求域；OSS 直接用 default。 */
  resolveSkillResourceDomain(req: Request): Promise<SkillResourceDomainResult | SkillResourceDomainFailure>;
  /** 知识治理与技能写。OSS 放行。企业走菜单权限。 */
  requirePermission(keys: readonly string[]): RequestHandler;
  /** MCP 服务管理路由。错误文案与菜单权限不同，不能并进 requirePermission。 */
  guardMcpServiceManagement: RequestHandler;
  /** 诊断路由。企业先要求域再要求 observer；OSS 放行。 */
  observeAccess: RequestHandler;
  /**
   * 企业缺域 403。OSS 固定返回 default，不采用入参里的域，
   * 避免请求自报域把单域存储拆开。
   */
  requireDomainId(identity: { domainId?: string | null }): string;
}
