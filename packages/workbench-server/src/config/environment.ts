import { workbenchProduct } from "../product/installed";
import { runtimeDefaults } from "../runtime/defaults";

const read = (name: string) => process.env[name];
const nonNegative = (value: unknown, fallback: number | undefined) =>
  Math.max(0, parseInt(String(value || fallback), 10));

export const environment = {
  node: () => read("NODE_ENV"),
  level: () => read("LOG_LEVEL"),
  logDir: () => read(workbenchProduct().logDirEnvName),
  pgConnection: () => read("DATABASE_URL") || read("PG_CONNECTION_STRING") || runtimeDefaults().postgresFallback,
  pgSchema: () => read("PG_SCHEMA") || "public",
  queryBase: () => read("DATA_QUERY_BASE_URL"),
  queryTimeout: () => parseInt(read("DATA_QUERY_TIMEOUT") || "30000", 10),
  queryKey: () => read("DATA_QUERY_API_KEY"),
  subQuestionInterval: (fallback: number | undefined) =>
    nonNegative(read("SUB_QUESTION_QUERY_INTERVAL_MS"), fallback),
  reportCooldown: (fallback: number | undefined) =>
    nonNegative(read("REPORT_GENERATION_COOLDOWN_MS"), fallback),
  replayCommand: () =>
    read("ABC_REPLAY_PYTHON_COMMAND") || read("HOT_REPORT_PYTHON_COMMAND") || "python3",
  replayDir: (fallback: string) =>
    read("ABC_REPLAY_DIR") || read("HOT_REPORT_REPLAY_DIR") || fallback,
  chromium: () => read("CHROMIUM_EXECUTABLE_PATH") || undefined,
  smtp: () => {
    const user = read("SMTP_USER") || "";
    return {
      host: read("SMTP_HOST"),
      port: Number(read("SMTP_PORT")) || 587,
      secure: read("SMTP_SECURE") === "true",
      user,
      pass: read("SMTP_PASS") || "",
      from: read("SMTP_FROM") || user || workbenchProduct().smtpFromAddress,
    };
  },
  retention: () => read("DIAGNOSIS_RETENTION_FILE"),
  observeNodes: () => read("OBSERVE_BACKEND_NODES") || read("BACKEND_NODES"),
  observeBucket: () => read("OBSERVE_BACKEND_INFO_BUCKET_ROOT"),
  observeWorkspaces: () => read("OBSERVE_TRACE_WORKSPACE_ROOT"),
};
