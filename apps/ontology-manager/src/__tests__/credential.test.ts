import { beforeEach, describe, expect, it } from "vitest";
import { clearSessionCredential, consumeLaunchCredential, sessionCredential } from "../credential";

const MAIN_TOKEN_KEYS = ["data_agent_token", "ontomato_token"];

function launch(search: string, hash = "") {
  window.history.replaceState({}, "", `/manager/${search}${hash}`);
  consumeLaunchCredential();
  return sessionCredential(null);
}

describe("launch credential and tab session", () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    MAIN_TOKEN_KEYS.forEach((key) => localStorage.setItem(key, `main-${key}`));
  });

  it("tk is written to the session; only tk/apiKey are removed and the rest of the query and hash stay", () => {
    expect(launch("?view=assets&tk=t1&theme=dark", "#/objects/A?from=object")).toEqual({
      type: "token",
      token: "t1",
    });
    expect(window.location.search).toBe("?view=assets&theme=dark");
    expect(window.location.hash).toBe("#/objects/A?from=object");
  });

  it("an apiKey alone is written to the session", () => {
    expect(launch("?apiKey=k1")).toEqual({ type: "apiKey", apiKey: "k1" });
    expect(window.location.search).toBe("");
  });

  it("with both tk and apiKey, tk wins and apiKey is not kept", () => {
    expect(launch("?tk=t1&apiKey=k1")).toEqual({ type: "token", token: "t1" });
    expect(sessionStorage.length).toBe(1);
  });

  it("a token launch followed by an apiKey-only launch: the new key replaces the old token", () => {
    launch("?tk=t1");
    expect(launch("?apiKey=k2")).toEqual({ type: "apiKey", apiKey: "k2" });
    expect(sessionStorage.getItem("ontology_manager_token")).toBeNull();
  });

  it("an apiKey launch followed by a tk launch: the new token replaces the old key", () => {
    launch("?apiKey=k1");
    expect(launch("?tk=t2")).toEqual({ type: "token", token: "t2" });
    expect(sessionStorage.getItem("ontology_manager_api_key")).toBeNull();
  });

  it("parameters present but empty: explicitly clears the session and removes the empty parameters", () => {
    launch("?tk=t1");
    expect(launch("?tk=&apiKey=&view=assets")).toBeNull();
    expect(sessionStorage.length).toBe(0);
    expect(window.location.search).toBe("?view=assets");
    launch("?apiKey=k1");
    expect(launch("?apiKey")).toBeNull();
  });

  it("no parameters at all (reload) keeps this tab's session and leaves the URL unchanged", () => {
    launch("?tk=t1");
    expect(launch("?view=assets", "#/data")).toEqual({ type: "token", token: "t1" });
    expect(window.location.search).toBe("?view=assets");
  });

  it("returns the app-supplied default when there is no session credential", () => {
    window.history.replaceState({}, "", "/manager/");
    consumeLaunchCredential();
    expect(sessionCredential({ type: "anonymous" })).toEqual({ type: "anonymous" });
    expect(sessionCredential(null)).toBeNull();
  });

  it("clearing removes only the two session keys", () => {
    launch("?tk=t1");
    sessionStorage.setItem("other", "x");
    clearSessionCredential();
    expect(sessionStorage.getItem("other")).toBe("x");
    expect(sessionStorage.length).toBe(1);
  });

  it("never reads, writes or removes the main system's long-lived token", () => {
    expect(launch("")).toBeNull();
    launch("?tk=t1");
    launch("?tk=");
    MAIN_TOKEN_KEYS.forEach((key) => expect(localStorage.getItem(key)).toBe(`main-${key}`));
    expect(localStorage.length).toBe(MAIN_TOKEN_KEYS.length);
  });
});
