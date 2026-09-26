import type { ManagerCredential } from "@ontomato/ontology-manager";

const TOKEN_KEY = "ontology_manager_token";
const API_KEY_KEY = "ontology_manager_api_key";

/**
 * 启动凭据只保存在当前标签页的 sessionStorage，不读写主系统的长期 token。
 * 地址带 tk 或 apiKey 参数（含空值）即一次新的启动：有效 tk 优先，否则有效 apiKey，
 * 两者都空就是显式清除；新值总是替换本标签页的旧凭据。完全不带这两个参数（刷新）沿用会话。
 * 消费后只从地址栏移除这两个参数，其余 query 与 hash 保留。
 */
export function consumeLaunchCredential() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has("tk") && !url.searchParams.has("apiKey")) return;
  const token = url.searchParams.get("tk");
  const apiKey = url.searchParams.get("apiKey");
  clearSessionCredential();
  if (token) sessionStorage.setItem(TOKEN_KEY, token);
  else if (apiKey) sessionStorage.setItem(API_KEY_KEY, apiKey);
  url.searchParams.delete("tk");
  url.searchParams.delete("apiKey");
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

/** 本标签页当前凭据，token 优先；都没有时用应用给定的默认（开源匿名，企业 null）。 */
export function sessionCredential(noCredential: ManagerCredential | null): ManagerCredential | null {
  const token = sessionStorage.getItem(TOKEN_KEY);
  if (token) return { type: "token", token };
  const apiKey = sessionStorage.getItem(API_KEY_KEY);
  if (apiKey) return { type: "apiKey", apiKey };
  return noCredential;
}

export function clearSessionCredential() {
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(API_KEY_KEY);
}
