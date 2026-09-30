import { defineConfig, loadEnv } from "vite";
import vue from "@vitejs/plugin-vue";
import path from "node:path";

export default defineConfig(({ command, mode }) => {
  // The dev proxy points directly at DataRAG: the /api/data-query prefix is stripped here, so running does not depend on the ontomato Node service.
  // It only serves the default /api base; a non-default API_BASE is proxied by the deployment gateway.
  // Load the product repository root env first, then allow ontology-manager env values to override it.
  const env = {
    ...loadEnv(mode, path.resolve(process.cwd(), "../.."), ""),
    ...loadEnv(mode, process.cwd(), ""),
  };
  const dataragOrigin = (
    process.env.DATARAG_ORIGIN ||
    env.DATARAG_ORIGIN ||
    env.DATA_QUERY_BASE_URL
  )?.replace(/\/+$/, "");
  if (command === "serve" && !dataragOrigin) {
    throw new Error(
      "DATARAG_ORIGIN or DATA_QUERY_BASE_URL is not set: the ontology manager dev proxy needs the DataRAG root address"
    );
  }
  return {
    plugins: [vue()],
    build: { outDir: "dist", emptyOutDir: true },
    server: {
      port: 5174,
      proxy: {
        "/api/data-query": {
          target: dataragOrigin,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/data-query/, ""),
        },
      },
    },
  };
});
