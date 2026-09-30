import { Request } from "express";

export function getTokenFromRequest(req: Request): string {
  return String(req.header("tk") || "").trim() || String(req.query.tk || "").trim();
}

export function getApiKeyFromRequest(req: Request): string {
  return String(req.header("x-api-key") || "").trim() || String(req.query.apiKey || "").trim();
}

export function getLocaleFromRequest(req: Request): string {
  const acceptLang = String(req.header("accept-language") || "");
  const primary = acceptLang.split(",")[0]?.split(";")[0]?.trim();
  return primary || String(req.query.locale || "").trim();
}

export function getClientIdFromRequest(req: Request): string {
  return String(req.header("x-client-id") || "").trim();
}
