import { Request, Response } from "express";
import { Readable } from "node:stream";
import { toErrorMessage } from "../../utils/errors";
import {
  getLocaleFromRequest,
  getTokenFromRequest,
  getClientIdFromRequest,
  getApiKeyFromRequest,
} from "./request";

export async function proxyResponse(upstreamRes: globalThis.Response, res: Response) {
  const contentType = upstreamRes.headers.get("content-type") || "application/json; charset=utf-8";
  // A media type may carry parameters like charset; only text/event-stream is recognized, everything else is still returned as a whole.
  if (contentType.split(";", 1)[0].trim() === "text/event-stream") {
    const reader = upstreamRes.body!.getReader();
    const onClose = () => {
      void reader.cancel();
    };
    res.on("close", onClose);
    res.status(upstreamRes.status);
    res.setHeader("Content-Type", contentType);
    res.flushHeaders();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
    } catch {
      // Status code and headers are already written; once reading is interrupted the only option is to end this SSE.
    } finally {
      res.off("close", onClose);
      res.end();
    }
    return;
  }

  const body = await upstreamRes.text();
  res.status(upstreamRes.status);
  res.setHeader("Content-Type", contentType);
  res.send(body);
}

export function buildUpstreamHeaders(req: Request): Record<string, string> {
  const tk = getTokenFromRequest(req);
  const apiKey = getApiKeyFromRequest(req);
  const locale = getLocaleFromRequest(req);
  const xClientId = getClientIdFromRequest(req);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Requested-With": "XMLHttpRequest",
  };
  if (apiKey) headers["x-api-key"] = apiKey;
  if (tk) headers.tk = tk;
  if (xClientId) headers["x-client-id"] = xClientId;
  if (locale) headers["Accept-Language"] = locale;
  return headers;
}

export async function proxyUpstream(
  req: Request,
  res: Response,
  baseUrl: string,
  upstreamPath: string,
  method?: string
) {
  try {
    const headers = buildUpstreamHeaders(req);
    let body: string | ReadableStream<Uint8Array> | undefined;
    if (req.is("multipart/form-data")) {
      // express.json does not parse multipart and the request stream is unread: forward it as-is together with the boundary-carrying Content-Type (external agent file uploads).
      headers["Content-Type"] = req.headers["content-type"]!;
      body = Readable.toWeb(req) as ReadableStream<Uint8Array>;
    } else if (req.method !== "GET") {
      body = JSON.stringify(req.body);
    }
    const upstreamRes = await fetch(`${baseUrl}${upstreamPath}`, {
      method: method || req.method,
      headers,
      body,
      duplex: "half",
    } as Parameters<typeof fetch>[1]);
    return proxyResponse(upstreamRes, res);
  } catch (error) {
    res.status(500).json({ success: false, message: toErrorMessage(error) });
  }
}
