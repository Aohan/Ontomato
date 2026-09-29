import { Request, Response, NextFunction } from "express";
import { createLogger } from "../../logging/logger";
import type { AuthenticatedRequest } from "../../utils/request-identity";

const logger = createLogger("access");

/**
 * Compact request logging middleware; records only slow requests and abnormal status codes.
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();
  const authReq = req as AuthenticatedRequest;

  res.on("finish", () => {
    const duration = Date.now() - start;
    const level = res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : undefined;
    const isSlow = duration > 500;

    if (!level && !isSlow) return;

    logger[level || "warn"]("access", {
      method: req.method,
      path: req.path,
      status: res.statusCode,
      duration,
      userId: authReq.userId ?? undefined,
    });
  });

  next();
}
