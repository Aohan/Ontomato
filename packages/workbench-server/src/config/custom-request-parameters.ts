export type JsonObject = Record<string, unknown>;

export class CustomRequestParametersError extends Error {}

export function normalizeCustomRequestParameters(value: unknown): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CustomRequestParametersError("customRequestParameters must be a JSON object");
  }
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}
