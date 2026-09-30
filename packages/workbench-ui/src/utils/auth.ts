import type { RequestIdentity } from "@ontomato/contracts/identity";

export type WorkbenchSessionVerdict = "valid" | "invalid" | "unreachable";
export type WorkbenchUserInfo = Partial<
  Pick<RequestIdentity, "userId" | "loginCode" | "userName" | "domainId">
>;

/**
 * Authentication host supplied by the app. Shared code reads the current credential only through it and lets the host
 * decide on unsuccessful responses; an app may implement it with a login session, while open source has no
 * authentication (the credential is always empty and no state is taken over).
 */
export interface WorkbenchAuthHost {
  getToken(): string | null;
  getApiKey(): string | null;
  /**
   * On an unsuccessful status the host decides whether to throw its own error instead (and run its navigation side
   * effects); returning null uses the generic HTTP error. credential is the token || apiKey captured when the request was
   * sent, so the host can tell whether the response belongs to a credential that has since been replaced.
   */
  responseStatusError(status: number, credential: string | null): Error | null;
  /** Current signed-in user: chat thread ownership and the "current thread" memory key read only these four fields; null in open source, which has no login. */
  getUserInfo(): WorkbenchUserInfo | null;
  /**
   * Asks whether the session is still valid when a stream failed to connect (the host merges concurrent calls and
   * returns unreachable when the credential has changed); callers still check the credential captured at start.
   * Always valid in open source.
   */
  verifySessionOnce(): Promise<WorkbenchSessionVerdict>;
  /** The single exit for expired authentication; does nothing in open source, which has no authentication. */
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
