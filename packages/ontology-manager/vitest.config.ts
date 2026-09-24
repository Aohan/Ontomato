import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // 只有组件用例跑在 DOM 里。
    environmentMatchGlobs: [["**/*.component.test.ts", "happy-dom"]],
    include: ["src/**/__tests__/**/*.test.ts"],
  },
});
