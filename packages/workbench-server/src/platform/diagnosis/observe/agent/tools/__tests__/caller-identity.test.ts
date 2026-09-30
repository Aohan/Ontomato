import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  backendGet: vi.fn(),
  buildTurnWorkspace: vi.fn(),
  verifyThreadDomain: vi.fn(),
  loadManifest: vi.fn(),
}));

vi.mock("../../../../../../utils/backend-client", () => ({
  backendGet: mocks.backendGet,
}));

vi.mock("../../../workspaces/builder", () => ({
  buildTurnWorkspace: mocks.buildTurnWorkspace,
}));

vi.mock("../../../../../../infrastructure/connection", () => ({
  getCheckpointer: () => ({
    verifyThreadDomain: mocks.verifyThreadDomain,
  }),
}));

vi.mock("../../../workspaces/store", () => ({
  loadManifest: mocks.loadManifest,
  getWorkspacePath: (turnKey: string) => `/tmp/workspace/${turnKey}`,
  deleteWorkspace: () => true,
}));

import { configureI18n } from "../../../../../../i18n";
import { appTextEn } from "../../../../../../i18n/app-text-en";
import { en, enLocaleMeta } from "../../../../../../i18n/locales/en";
import { createServiceHealthTool } from "../service-health-tool";
import { createCollectTurnArtifactsTool } from "../collect-turn-artifacts-tool";

configureI18n({
  defaultLocale: "en",
  languageSwitchEnabled: false,
  appTextLocale: "en",
  packs: { en: { messages: { ...en, ...appTextEn }, ...enLocaleMeta } },
});

describe("diagnosis tools caller identity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.backendGet.mockResolvedValue({
      text: JSON.stringify({ backend: { service: { status: "running" } } }),
    });
    mocks.buildTurnWorkspace.mockResolvedValue({ status: "completed" });
    mocks.loadManifest.mockReturnValue(null);
  });

  it("invariant 1: passes apiKey to backend calls and uses session domain without resolving domain by token", async () => {
    const caller = {
      domainId: "test-domain",
      apiKey: "test-api-key",
    };

    // 1) Service health tool forwards apiKey
    const healthTool = createServiceHealthTool(caller);
    await healthTool.execute("call-health", {});

    expect(mocks.backendGet).toHaveBeenCalledWith(
      "/maintenance/getserviceinfo",
      expect.stringContaining("/maintenance/getserviceinfo"),
      expect.objectContaining({
        apiKey: "test-api-key",
        token: undefined,
      })
    );

    // 2) Collect tool uses session domain and forwards apiKey to buildTurnWorkspace
    const collectTool = createCollectTurnArtifactsTool(caller);
    await collectTool.execute("call-collect", { turnKey: "turn.thread-1.0" });

    expect(mocks.verifyThreadDomain).toHaveBeenCalledWith("thread-1", "test-domain");
    expect(mocks.buildTurnWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({
        turnKey: "turn.thread-1.0",
        domainId: "test-domain",
        apiKey: "test-api-key",
        token: undefined,
      })
    );
  });

  it("invariant 2: initiates backend call without credential rejection in open-source shape", async () => {
    const caller = {
      domainId: "default",
    };

    const healthTool = createServiceHealthTool(caller);
    await healthTool.execute("call-health-oss", {});

    expect(mocks.backendGet).toHaveBeenCalledWith(
      "/maintenance/getserviceinfo",
      expect.stringContaining("/maintenance/getserviceinfo"),
      expect.objectContaining({
        apiKey: undefined,
        token: undefined,
      })
    );
  });
});
