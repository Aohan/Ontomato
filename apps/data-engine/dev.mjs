// Host Java dev entry of the open-source product: the build entry's resources and default language,
// the public Maven wrapper for this platform, no license profile. Needs apps/data-engine/.env; the
// .venv is prepared on start (see docs/development.md).
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mavenWrapper, runDevJava } from "../../scripts/data-engine/dev-java.mjs";
import { app } from "./build.mjs";

runDevJava({ app, appDir: dirname(fileURLToPath(import.meta.url)), wrapper: mavenWrapper(app.repoRoot), profiles: [] });
