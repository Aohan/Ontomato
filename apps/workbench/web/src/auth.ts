import type { WorkbenchAuthHost } from "@ontomato/workbench-ui";

/** No authentication in open source (originally utils/auth.ts): no credential; 401/402 are handled as ordinary request errors. */
export const anonymousAuthHost: WorkbenchAuthHost = {
  getToken: () => null,
  getApiKey: () => null,
  responseStatusError: () => null,
  getUserInfo: () => null,
  verifySessionOnce: () => Promise.resolve("valid"),
  handleAuthExpired: () => {},
};
