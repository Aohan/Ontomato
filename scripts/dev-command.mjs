// Native replacement for POSIX-only environment assignments in package scripts.
// Uses the already installed development CLIs, not a second shell or dependency.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WINDOWS = process.platform === "win32";

// Pure: mode + product -> the child's env/tool/args/cwd. `product.dataragOrigin`
// is the edition's own default and never overrides what the caller already set;
// the shared entry passes none, so the open-source edition keeps its old behavior.
// server/web/manager pass the entry, config and root as absolute paths so a
// Windows process can be bound back to this checkout by its argv alone (no cwd).
export function configuration(mode, { root, dataragOrigin }, inherited = process.env) {
  const env = { ...inherited };
  let tool, args, cwd = root;
  switch (mode) {
    case "dev":
      env.NODE_ENV = "development";
      env.ONTOLOGY_MANAGER_URL = "http://localhost:5174";
      if (dataragOrigin) env.DATARAG_ORIGIN ||= dataragOrigin;
      tool = "concurrently";
      args = ["pnpm:dev:server", "pnpm:dev:web", "pnpm:dev:ontology-manager"];
      break;
    case "server":
      env.NODE_ENV = "development";
      tool = "tsx";
      args = ["watch", join(root, "apps/workbench/src/index.ts")];
      cwd = resolve(root, "apps/workbench");
      break;
    case "web":
      tool = "vite";
      args = ["--config", join(root, "apps/workbench/web/vite.config.ts")];
      cwd = resolve(root, "apps/workbench");
      break;
    case "manager":
      if (dataragOrigin) env.DATARAG_ORIGIN ||= dataragOrigin;
      tool = "vite";
      args = [resolve(root, "apps/ontology-manager"), "--port", "5174"];
      cwd = resolve(root, "apps/ontology-manager");
      break;
    default:
      throw new Error(`Unknown development command: ${mode}`);
  }
  return { env, tool, args, cwd };
}

// Foreground child signal ownership, shared with the full-stack entry: Unix forwards SIGINT/SIGTERM
// to the child. Windows forward is impossible with child.kill (it is TerminateProcess there), and the
// console already delivered Ctrl-C to every attached process, so we only keep a listener alive until
// the child settles; a second Ctrl-C has no listener left and force-quits us.
export function holdForeground(child) {
  if (WINDOWS) {
    const hold = () => {};
    process.once("SIGINT", hold);
    process.once("SIGTERM", hold);
    return () => {
      process.removeListener("SIGINT", hold);
      process.removeListener("SIGTERM", hold);
    };
  }
  const interrupt = () => child.kill("SIGINT");
  const terminate = () => child.kill("SIGTERM");
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", terminate);
  return () => {
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", terminate);
  };
}

// Each mode resolves its CLI from that mode's own cwd, so the shared public
// helper never picks the public workspace's copy for a private entry.
export function start(product) {
  const settings = configuration(process.argv[2], product);
  const requireFromCwd = createRequire(resolve(settings.cwd, "package.json"));
  const manifestPath = requireFromCwd.resolve(`${settings.tool}/package.json`);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const entry = typeof manifest.bin === "string" ? manifest.bin : manifest.bin?.[settings.tool];
  if (!entry) throw new Error(`Missing ${settings.tool} CLI in ${settings.tool}; run pnpm install`);
  const child = spawn(
    process.execPath,
    [resolve(dirname(manifestPath), entry), ...settings.args, ...process.argv.slice(3)],
    { env: settings.env, cwd: settings.cwd, stdio: "inherit", shell: false }
  );
  const release = holdForeground(child);
  child.once("error", (error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
  child.once("close", (code, signal) => {
    release();
    process.exitCode = code ?? (signal === "SIGINT" ? 130 : 1);
  });
  return child;
}

export function runCli(product) {
  try {
    start(product);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli({ root: ROOT });
}
