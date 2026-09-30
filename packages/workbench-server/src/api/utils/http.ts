import type { HttpErrorResponse } from "@ontomato/contracts/http";
import { Request, Response, NextFunction } from "express";
import { toErrorMessage } from "../../utils/errors";
import { createLogger } from "../../logging/logger";

export function buildAttachmentContentDisposition(fileName: string) {
  const normalized = String(fileName || "download")
    .replace(/[\r\n]/g, " ")
    .trim();

  const asciiFallback =
    normalized
      .normalize("NFKD")
      .replace(/[^\x20-\x7E]/g, "_")
      .replace(/[\\/:*?"<>|;]/g, "_")
      .replace(/\s+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "") || "download";

  const encoded = encodeURIComponent(normalized).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  );

  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}

export function sendError(res: Response, error: unknown, status?: number) {
  const fallbackStatus = typeof (error as any)?.status === "number" ? (error as any).status : 500;
  const finalStatus = status ?? fallbackStatus;
  const message = toErrorMessage(error);
  const body: HttpErrorResponse = { success: false, error: message };
  const explicitCode = (error as { code?: unknown } | null)?.code;

  if (typeof explicitCode === "string") {
    body.code = explicitCode;
  } else if (finalStatus >= 400 && finalStatus < 500) {
    body.code =
      finalStatus === 401
        ? "UNAUTHORIZED"
        : finalStatus === 403
          ? "FORBIDDEN"
          : finalStatus === 404
            ? "NOT_FOUND"
            : finalStatus === 422
              ? "VALIDATION_ERROR"
              : "BAD_REQUEST";
  }

  const details = (error as { details?: unknown } | null)?.details;
  if (details && typeof details === "object") {
    body.details = details;
  }

  res.status(finalStatus).json(body);
}

export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch((error) => {
      sendError(res, error);
    });
  };
}

const routeLogger = createLogger("api:route");

export function asyncHandlerWithLog(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>,
  context: string
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch((error) => {
      routeLogger.error(`[${context}] ${toErrorMessage(error)}`);
      sendError(res, error);
    });
  };
}
