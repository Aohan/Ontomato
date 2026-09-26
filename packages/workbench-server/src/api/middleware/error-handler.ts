import { Request, Response, NextFunction } from "express";
import { createLogger } from "../../logging/logger";
import { tApp } from "../../i18n";
import { sendError } from "../utils/http";
import { HttpError } from "../../utils/errors";
const logger = createLogger("error-handler");

/**
 * Global Express error handler.
 *
 * Catches errors thrown or passed via `next(err)` from any route.
 * Returns a unified `{ success: false, error, code?, details? }` JSON body.
 *
 * Must be registered AFTER all route and middleware registrations.
 */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (res.headersSent) {
    return;
  }

  const status =
    err instanceof HttpError
      ? err.status
      : typeof (err as any)?.status === "number"
        ? (err as any).status
        : 500;

  const message = err instanceof Error ? err.message : String(err);

  if (status >= 500) {
    logger.error(tApp("foundation.log.server.uncaught"), {
      path: req.path,
      method: req.method,
      error: message,
      stack: err instanceof Error ? err.stack : undefined,
    });
  }

  sendError(res, err, status);
}
