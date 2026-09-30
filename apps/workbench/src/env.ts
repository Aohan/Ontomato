import path from "node:path";
import dotenv from "dotenv";
import { productRoot } from "./root";

// The entry's first import: evaluated before any module that reads configuration. Reads only the product root .env;
// dotenv does not override process variables by default, so the real process environment wins.
dotenv.config({ path: path.join(productRoot, ".env") });
