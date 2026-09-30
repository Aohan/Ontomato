import { fileURLToPath } from "node:url";

/** OSS product root: this repository's root (inside the image, /app). .env and the runtime data data/ both live here. */
export const productRoot = fileURLToPath(new URL("../../../", import.meta.url));
