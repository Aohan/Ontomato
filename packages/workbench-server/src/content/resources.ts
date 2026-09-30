import { fileURLToPath } from "node:url";

/** Read-only default resource root carried by this package: prompts/, skills/, data/{echart,knowledge,skills}/. */
export const workbenchServerResourceRoot = fileURLToPath(new URL("../../", import.meta.url));
