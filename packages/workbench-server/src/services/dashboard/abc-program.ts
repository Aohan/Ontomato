import type { AbcProgramDashboard } from "@ontomato/contracts/dashboard";

export function normalizeAbcProgram(value: unknown): AbcProgramDashboard | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const title = String(record.title || "").trim();
  const code = String(record.code || "");
  const outKeyRefs = Array.isArray(record.outKeyRefs) ? record.outKeyRefs : [];
  if (!code || outKeyRefs.length === 0) return null;
  return {
    title,
    code,
    outKeyRefs: outKeyRefs as AbcProgramDashboard["outKeyRefs"],
    parameters: Array.isArray(record.parameters)
      ? (record.parameters as AbcProgramDashboard["parameters"])
      : undefined,
  };
}
export function buildAbcProgramQueryPayload(program: AbcProgramDashboard, parameters?: unknown[]) {
  return {
    title: program.title,
    code: program.code,
    outKeyRefs: Array.isArray(program.outKeyRefs) ? program.outKeyRefs : [],
    parameters: normalizeAbcProgramParametersForApi(
      Array.isArray(parameters)
        ? parameters
        : Array.isArray(program.parameters)
          ? program.parameters
          : []
    ),
  };
}
export function normalizeAbcProgramParametersForUi(parameters: unknown[] | undefined) {
  return (Array.isArray(parameters) ? parameters : [])
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    .map((item) => {
      const type = String(item.type || item.valueType || "STRING").trim() || "STRING";
      const value = item.value ?? item.originSample;
      return {
        ...item,
        key: String(item.key || ""),
        name: item.name ? String(item.name) : undefined,
        type,
        value,
        valueType: type,
        operator: typeof item.operator === "string" ? item.operator : "=",
        originSample: value,
        className: item.className ? String(item.className) : "",
        attrName: item.attrName ? String(item.attrName) : "",
      };
    })
    .filter((item) => item.key);
}
function normalizeAbcProgramParametersForApi(parameters: unknown[]) {
  return parameters
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    .map((item) => ({
      key: String(item.key || ""),
      name: item.name ? String(item.name) : undefined,
      type: String(item.type || item.valueType || "STRING"),
      value: item.originSample ?? item.value,
      className: item.className ? String(item.className) : "",
      attrName: item.attrName ? String(item.attrName) : "",
    }))
    .filter((item) => item.key);
}
