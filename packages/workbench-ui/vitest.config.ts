import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: "happy-dom",
    // Manager entry tests render an iframe pointing at a test URL; iframe pages are not loaded, so tests make no network requests.
    environmentOptions: { happyDOM: { settings: { disableIframePageLoading: true } } },
    include: ["src/**/__tests__/**/*.test.ts"],
    setupFiles: ["src/__tests__/setup.ts"],
  },
});
