// Public product image selection and release checks precede shared transport.
import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";
import { output } from "./build-support.mjs";
import { buildBundle, parseBundleOptions } from "./deploy-bundle.mjs";

export function main(argv) {
  const options = parseBundleOptions(argv);
  const repositories = ["ontomato-workbench", "ontomato-data-engine", "ontomato-ontology-manager"];
  const components = ["ontomato", "datarag-opensource", "ontomato-ontology-manager"];
  return buildBundle(options, {
    name: "ontomato",
    deployDir: fileURLToPath(new URL("../deploy/", import.meta.url)),
    images: [
      ...repositories.map((name) => `${options["--registry"]}/${name}:${options["--image-tag"]}-${options["--arch"]}`),
      options["--postgres"] || "docker.io/pgvector/pgvector:pg18",
    ],
    validateImages(images) {
      for (let i = 0; i < components.length; i++) {
        const image = JSON.parse(output("docker", ["image", "inspect", images[i]]))[0];
        const labels = image.Config.Labels || {};
        if (labels["io.ontomato.component"] !== components[i]
          || labels["org.opencontainers.image.version"] !== options["--version"])
          throw new Error(`Wrong component/version: ${images[i]}`);
      }
    },
  });
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); }
  catch (error) { console.error(`[bundle] ${error.message}`); process.exitCode = 1; }
}
