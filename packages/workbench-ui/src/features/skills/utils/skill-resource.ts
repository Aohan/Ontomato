import { authHost } from "../../../utils/auth";

const SKILL_RESOURCE_URL = /(["'])(\/api\/skills\/resources\/[^"'<>\s]+)\1/g;
const PUBLIC_ECHART_RESOURCES: Record<string, string> = {
  "/api/skills/resources/executable/visualization/echarts/scripts/echarts.min.js":
    "/api/echart/echarts.min.js",
};

export function withSkillResourceCredentials(html: string): string {
  const token = authHost().getToken();
  const apiKey = authHost().getApiKey();
  if (!html.includes("/api/skills/resources/")) return html;

  return html.replace(SKILL_RESOURCE_URL, (_match, quote: string, resourceUrl: string) => {
    const url = new URL(resourceUrl, "http://skill-resource.local");
    const publicResource = PUBLIC_ECHART_RESOURCES[url.pathname];
    if (publicResource) return `${quote}${publicResource}${quote}`;

    url.searchParams.delete("tk");
    url.searchParams.delete("apiKey");
    if (token) url.searchParams.set("tk", token);
    else if (apiKey) url.searchParams.set("apiKey", apiKey);
    return `${quote}${url.pathname}${url.search}${url.hash}${quote}`;
  });
}
