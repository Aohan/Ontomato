import { beforeAll, describe, expect, it } from "vitest";
import zhCN from "element-plus/es/locale/lang/zh-cn";
import publicZhCN from "../../../../locales/zh-CN";
import { installWorkbenchI18n } from "../../../../i18n";

// 原断言是企业原中文标签：本文件改装企业 zh-CN 语言档（共享 setup 默认为开源 en）。
beforeAll(() => {
  installWorkbenchI18n({
    supported: ["zh-CN"],
    defaultLocale: "zh-CN",
    initialLocale: "zh-CN",
    switchEnabled: false,
    save: null,
    messages: { "zh-CN": publicZhCN },
    elementLocale: () => zhCN,
  });
});

import { sessionContextFromSession, sessionContextLabel } from "../session-context";

describe("session context helpers", () => {
  it("labels the selected session context instead of the current route", () => {
    expect(
      sessionContextLabel({
        id: "s1",
        createdAt: "2026-09-07T00:00:00.000Z",
        title: "通用页面历史",
        context: { page: "general" },
        responseStatus: "idle",
      })
    ).toBe("通用");
    expect(
      sessionContextLabel({
        id: "s2",
        createdAt: "2026-09-07T00:00:00.000Z",
        title: "Turn 历史",
        context: { page: "observe", targetKey: "turn.dGhyZWFkLTE.0" },
        responseStatus: "idle",
      })
    ).toBe("Turn: turn.dGhyZWFkLTE.0");
  });

  it("does not infer legacy runId fields when context is missing", () => {
    const legacy = {
      id: "legacy-run",
      createdAt: "2026-09-07T00:00:00.000Z",
      title: "旧测试",
      responseStatus: "idle" as const,
      runId: "run-old",
    };

    expect(sessionContextFromSession(legacy)).toBeUndefined();
  });
});
