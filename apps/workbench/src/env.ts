import path from "node:path";
import dotenv from "dotenv";
import { productRoot } from "./root";

// 入口的第一个导入：先于任何读取配置的模块求值。只读产品根 .env；
// dotenv 默认不覆盖进程已有变量，真实进程环境优先。
dotenv.config({ path: path.join(productRoot, ".env") });
