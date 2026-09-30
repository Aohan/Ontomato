import type { RequestIdentity } from "@ontomato/contracts/identity";
import { Request } from "express";
import { workbenchIdentity } from "../identity/installed";

export interface AuthenticatedRequest extends Request, RequestIdentity {
  token: string;
  apiKey: string;
  locale: string;
}

export function requireDomainId(identity: { domainId?: string | null }): string {
  return workbenchIdentity().requireDomainId(identity);
}
