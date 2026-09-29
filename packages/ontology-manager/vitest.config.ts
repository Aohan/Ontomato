import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: "node",
    // Only component tests run in the DOM.
    environmentMatchGlobs: [["**/*.component.test.ts", "happy-dom"]],
    include: ["src/**/__tests__/**/*.test.ts"],
  },
});
