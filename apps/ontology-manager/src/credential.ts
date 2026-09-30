import type { ManagerCredential } from "@ontomato/ontology-manager";

const TOKEN_KEY = "ontology_manager_token";
const API_KEY_KEY = "ontology_manager_api_key";

/**
 * The launch credential is kept only in this tab's sessionStorage; the main system's long-lived token is never read or written.
 * A URL with a tk or apiKey parameter (even empty) is a new launch: a non-empty tk wins, otherwise a non-empty apiKey,
 * and both empty means an explicit clear; the new value always replaces this tab's old credential. Without either
 * parameter (a reload) the session is kept. After consumption only these two parameters are removed from the address
 * bar; the rest of the query and the hash stay.
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

/** This tab's current credential, token first; without either, the app-supplied default (anonymous or null). */
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
