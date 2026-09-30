import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

// Web output goes to dist/web at the repository root: the Node production server serves static pages from the product root's dist/web.
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
