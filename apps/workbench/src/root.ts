import { fileURLToPath } from "node:url";

/** 开源产品根：本仓根目录（镜像内即 /app）。.env 与运行数据 data/ 都在这里。 */
export const productRoot = fileURLToPath(new URL("../../../", import.meta.url));
