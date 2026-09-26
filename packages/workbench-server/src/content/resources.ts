import { fileURLToPath } from "node:url";

/** 本包携带的只读默认资源根：prompts/、skills/、data/{echart,knowledge,skills}/。 */
export const workbenchServerResourceRoot = fileURLToPath(new URL("../../", import.meta.url));
