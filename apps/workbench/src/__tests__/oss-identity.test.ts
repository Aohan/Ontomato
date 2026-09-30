import { beforeEach, describe, expect, it, vi } from "vitest";
import { installWorkbenchIdentity, workbenchIdentity } from "@ontomato/workbench-server";
import { ossIdentity } from "../identity";

beforeEach(() => {
  installWorkbenchIdentity(ossIdentity);
});

describe("oss identity", () => {
  it("returns default for every domain check and ignores the supplied domain", () => {
    expect(workbenchIdentity().requireDomainId({ domainId: "other" })).toBe("default");
    expect(workbenchIdentity().requireDomainId({})).toBe("default");
  });

  it("does not verify a saved task token", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("must not verify");
    });
    vi.stubGlobal("fetch", fetchMock);
    await workbenchIdentity().confirmTaskOwner({
      userId: "row-user",
      domainId: "row-domain",
      token: "saved-token",
    });
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("keeps MCP on system/default and autotest on the run domain", async () => {
    const req = { header: () => "secret", query: { apiKey: "secret" } } as never;
    await expect(workbenchIdentity().resolveMcpCaller(req, "tool-key")).resolves.toEqual({
      userId: "system",
      domainId: "default",
    });
    await expect(
      workbenchIdentity().resolveAutotestActor({ token: "", domainId: "" })
    ).resolves.toEqual({ userId: "system", domainId: "default" });
    await expect(
      workbenchIdentity().resolveAutotestActor({ token: "tk", domainId: "run-domain" })
    ).resolves.toEqual({ userId: "system", domainId: "run-domain" });
  });
});
