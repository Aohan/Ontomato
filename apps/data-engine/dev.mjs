// Host Java dev entry of the open-source product: the build entry's resources and default language,
// the public Maven wrapper, no license profile. Needs apps/data-engine/.env and .venv (see README).
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runDevJava } from "../../scripts/data-engine/dev-java.mjs";
import { app } from "./build.mjs";

runDevJava({ app, appDir: dirname(fileURLToPath(import.meta.url)), wrapper: join(app.repoRoot, "mvnw"), profiles: [] });
