import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: "happy-dom",
    // Manager 入口用例会渲染指向测试地址的 iframe；不加载 iframe 页面，用例不发网络请求。
    environmentOptions: { happyDOM: { settings: { disableIframePageLoading: true } } },
    include: ["src/**/__tests__/**/*.test.ts"],
    setupFiles: ["src/__tests__/setup.ts"],
  },
});
