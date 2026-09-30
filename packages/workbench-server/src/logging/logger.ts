import { workbenchProduct } from "../product/installed";
import { getLogContext } from "./log-context";
import { appendJsonl } from "./log-file-transport";
import { environment } from "../config/environment";

type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/** Shape of a single JSONL log record written to the main log file. */
export interface AppLogRecord {
  domainId?: string;
  time: string;
  level: LogLevel;
  context: string;
  message: string;
  requestId?: string;
  turnKey?: string;
  threadId?: string;
  requestSeq?: number;
  taskId?: string;
  data?: Record<string, unknown>;
  error?: string;
}


class Logger {
  private level: LogLevel;
  private context: string;

  constructor(context: string = "app", level?: LogLevel) {
    this.context = context;
    this.level = level || this.getDefaultLevel();
  }

  private getDefaultLevel(): LogLevel {
    const envLevel = environment.level()?.toLowerCase() as LogLevel;
    if (envLevel && LOG_LEVELS[envLevel] !== undefined) {
      return envLevel;
    }
    return environment.node() === "production" ? "info" : "debug";
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.level];
  }

  private formatMessage(level: LogLevel, ...args: unknown[]): unknown[] {
    const timestamp = new Date().toISOString();
    const context = getLogContext();
    const contextKey = context?.turn?.turnKey || context?.taskId || context?.requestId;
    const contextTag = contextKey ? ` [${contextKey}]` : "";
    const prefix = `[${timestamp}] [${level.toUpperCase()}] [${this.context}]${contextTag}`;
    return [prefix, ...args];
  }

  /**
   * Build an AppLogRecord from variadic args and write to JSONL file.
   * Errors during file write are swallowed silently.
   */
  private writeToFile(level: LogLevel, args: unknown[]): void {
    try {
      const now = new Date().toISOString();
      const context = getLogContext();
      const turn = context?.turn;

      // Separate the first string message from optional data / error objects
      let message = "";
      let data: Record<string, unknown> | undefined;
      let errorStr: string | undefined;

      for (const arg of args) {
        if (arg instanceof Error) {
          errorStr = arg.stack || arg.message;
        } else if (typeof arg === "string") {
          message = message ? `${message} ${arg}` : arg;
        } else if (typeof arg === "object" && arg !== null) {
          // Merge plain objects into data
          data = { ...(data || {}), ...(arg as Record<string, unknown>) };
        } else if (arg !== undefined) {
          message = message ? `${message} ${String(arg)}` : String(arg);
        }
      }

      const record: AppLogRecord = {
        ...(context?.domainId ? { domainId: context.domainId } : {}),
        time: now,
        level,
        context: this.context,
        message,
        ...(context?.requestId ? { requestId: context.requestId } : {}),
        ...(turn
          ? { turnKey: turn.turnKey, threadId: turn.threadId, requestSeq: turn.requestSeq }
          : {}),
        ...(context?.taskId ? { taskId: context.taskId } : {}),
        ...(data ? { data } : {}),
        ...(errorStr ? { error: errorStr } : {}),
      };

      appendJsonl(workbenchProduct().logFileName, record as unknown as Record<string, unknown>);
    } catch {
      // Never let file logging break the application.
    }
  }

  debug(...args: unknown[]): void {
    if (this.shouldLog("debug")) {
      console.debug(...this.formatMessage("debug", ...args));
      this.writeToFile("debug", args);
    }
  }

  info(...args: unknown[]): void {
    if (this.shouldLog("info")) {
      console.info(...this.formatMessage("info", ...args));
      this.writeToFile("info", args);
    }
  }

  warn(...args: unknown[]): void {
    if (this.shouldLog("warn")) {
      console.warn(...this.formatMessage("warn", ...args));
      this.writeToFile("warn", args);
    }
  }

  error(...args: unknown[]): void {
    if (this.shouldLog("error")) {
      console.error(...this.formatMessage("error", ...args));
      this.writeToFile("error", args);
    }
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  child(subContext: string): Logger {
    return new Logger(`${this.context}:${subContext}`, this.level);
  }
}

export function createLogger(context: string): Logger {
  return new Logger(context);
}

export const defaultLogger = createLogger("app");
