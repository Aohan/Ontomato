import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

// 网页产物输出到仓根 dist/web：Node 生产服务从产品根的 dist/web 提供静态页面。
export default defineConfig({
  base: "./",
  plugins: [vue()],
  root: fileURLToPath(new URL(".", import.meta.url)),
  build: {
    outDir: fileURLToPath(new URL("../../../dist/web", import.meta.url)),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3000",
      "/config.js": "http://localhost:3000",
    },
  },
});
