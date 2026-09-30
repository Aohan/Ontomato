import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { tApp } from "../../i18n";

interface ValidationErrorDetail {
  field: string;
  message: string;
}

function formatZodErrors(error: z.ZodError): ValidationErrorDetail[] {
  return error.issues.map((issue) => ({
    field: issue.path.join("."),
    message: issue.message,
  }));
}

/**
 * Returns Express middleware that validates `req.body` against the given
 * Zod schema. On failure, responds with 400 and a list of field-level errors.
 */
export function validateBody(schema: z.ZodTypeAny) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({
        success: false,
        error: tApp("foundation.validation.body"),
        details: formatZodErrors(result.error),
      });
      return;
    }
    req.body = result.data;
    next();
  };
}

/**
 * Returns Express middleware that validates `req.query` against the given
 * Zod schema.
 */
export function validateQuery(schema: z.ZodTypeAny) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      res.status(400).json({
        success: false,
        error: tApp("foundation.validation.query"),
        details: formatZodErrors(result.error),
      });
      return;
    }
    req.query = result.data as any;
    next();
  };
}

/**
 * Returns Express middleware that validates `req.params` against the given
 * Zod schema.
 */
export function validateParams(schema: z.ZodTypeAny) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.params);
    if (!result.success) {
      res.status(400).json({
        success: false,
        error: tApp("foundation.validation.params"),
        details: formatZodErrors(result.error),
      });
      return;
    }
    req.params = result.data as any;
    next();
  };
}
