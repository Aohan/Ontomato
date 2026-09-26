import type { RequestIdentity } from "@ontomato/contracts/identity";

export type WorkbenchSessionVerdict = "valid" | "invalid" | "unreachable";
export type WorkbenchUserInfo = Partial<
  Pick<RequestIdentity, "userId" | "loginCode" | "userName" | "domainId">
>;

/**
 * 应用装配的认证宿主。共享代码只经这里读取当前凭据，并把非成功响应交宿主裁决；
 * 企业由登录会话实现，开源无认证（凭据恒为空、不接管任何状态）。
 */
export interface WorkbenchAuthHost {
  getToken(): string | null;
  getApiKey(): string | null;
  /**
   * 请求得到非成功状态时由宿主决定是否改抛自己的错误（并执行其导航副作用）；返回 null 走通用 HTTP 错误。
   * credential 是该请求发出时捕获的 token || apiKey，供宿主判断响应是否属于已被替换的旧凭据。
   */
  responseStatusError(status: number, credential: string | null): Error | null;
  /** 当前登录用户：聊天线程归属与“当前线程”记忆键只读这四项；开源无登录为 null。 */
  getUserInfo(): WorkbenchUserInfo | null;
  /**
   * 流未建立连接时询问会话是否仍有效（并发合并、凭据已换返回 unreachable 由宿主负责）；
   * 调用方仍自行核对发起时捕获的凭据。开源恒为 valid。
   */
  verifySessionOnce(): Promise<WorkbenchSessionVerdict>;
  /** 认证失效的唯一出口；开源无认证，不做任何事。 */
  handleAuthExpired(): void;
}

let host: WorkbenchAuthHost | null = null;

export function installAuthHost(next: WorkbenchAuthHost): void {
  host = next;
}

export function authHost(): WorkbenchAuthHost {
  if (!host) throw new Error("Workbench auth host is not installed");
  return host;
}
