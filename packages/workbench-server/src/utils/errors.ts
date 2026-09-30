import { tApp } from "../i18n";

export enum ErrorCode {
  UNKNOWN = "UNKNOWN",
  API_NOT_CONFIGURED = "API_NOT_CONFIGURED",
  API_REQUEST_FAILED = "API_REQUEST_FAILED",
  QUERY_FAILED = "QUERY_FAILED",
  ANALYSIS_FAILED = "ANALYSIS_FAILED",
  VISUALIZATION_FAILED = "VISUALIZATION_FAILED",
  INVALID_INPUT = "INVALID_INPUT",
  NOT_FOUND = "NOT_FOUND",
  UNAUTHORIZED = "UNAUTHORIZED",
}

export interface AppError {
  code: ErrorCode;
  message: string;
  node?: string;
  details?: Record<string, unknown>;
  timestamp: number;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
    readonly details?: unknown
  ) {
    super(message);
  }
}

export class ErrorBuilder {
  private error: AppError;

  constructor(code: ErrorCode) {
    this.error = {
      code,
      message: "",
      timestamp: Date.now(),
    };
  }

  message(message: string): ErrorBuilder {
    this.error.message = message;
    return this;
  }

  node(node: string): ErrorBuilder {
    this.error.node = node;
    return this;
  }

  details(details: Record<string, unknown>): ErrorBuilder {
    this.error.details = details;
    return this;
  }

  build(): AppError {
    if (!this.error.message) {
      this.error.message = getDefaultMessage(this.error.code);
    }
    return this.error;
  }
}

function getDefaultMessage(code: ErrorCode): string {
  const messages: Record<ErrorCode, string> = {
    [ErrorCode.UNKNOWN]: tApp("foundation.error.unknown"),
    [ErrorCode.API_NOT_CONFIGURED]: tApp("foundation.error.apiNotConfigured"),
    [ErrorCode.API_REQUEST_FAILED]: tApp("foundation.error.apiRequestFailed"),
    [ErrorCode.QUERY_FAILED]: tApp("foundation.error.queryFailed"),
    [ErrorCode.ANALYSIS_FAILED]: tApp("foundation.error.analysisFailed"),
    [ErrorCode.VISUALIZATION_FAILED]: tApp("foundation.error.visualizationFailed"),
    [ErrorCode.INVALID_INPUT]: tApp("foundation.error.invalidInput"),
    [ErrorCode.NOT_FOUND]: tApp("foundation.error.notFound"),
    [ErrorCode.UNAUTHORIZED]: tApp("foundation.error.unauthorized"),
  };
  return messages[code];
}

export function createError(code: ErrorCode): ErrorBuilder {
  return new ErrorBuilder(code);
}

export function isAppError(error: unknown): error is AppError {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    "message" in error &&
    "timestamp" in error
  );
}

export function fromNativeError(error: Error, node?: string): AppError {
  return createError(ErrorCode.UNKNOWN)
    .message(error.message)
    .node(node || "unknown")
    .details({ stack: error.stack })
    .build();
}

export function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
