import type { WorkbenchAuthHost } from "@ontomato/workbench-ui";

/** 开源无认证（原 utils/auth.ts）：无凭据，401/402 按普通请求错误处理。 */
export const anonymousAuthHost: WorkbenchAuthHost = {
  getToken: () => null,
  getApiKey: () => null,
  responseStatusError: () => null,
  getUserInfo: () => null,
  verifySessionOnce: () => Promise.resolve("valid"),
  handleAuthExpired: () => {},
};
