import { beforeEach, describe, expect, it } from "vitest";
import { clearSessionCredential, consumeLaunchCredential, sessionCredential } from "../credential";

const MAIN_TOKEN_KEYS = ["data_agent_token", "ontomato_token"];

function launch(search: string, hash = "") {
  window.history.replaceState({}, "", `/manager/${search}${hash}`);
  consumeLaunchCredential();
  return sessionCredential(null);
}

describe("启动凭据与标签页会话", () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    MAIN_TOKEN_KEYS.forEach((key) => localStorage.setItem(key, `main-${key}`));
  });

  it("tk 写入会话，只移除 tk/apiKey，其余 query 与 hash 保留", () => {
    expect(launch("?view=assets&tk=t1&theme=dark", "#/objects/A?from=object")).toEqual({
      type: "token",
      token: "t1",
    });
    expect(window.location.search).toBe("?view=assets&theme=dark");
    expect(window.location.hash).toBe("#/objects/A?from=object");
  });

  it("仅 apiKey 写入会话", () => {
    expect(launch("?apiKey=k1")).toEqual({ type: "apiKey", apiKey: "k1" });
    expect(window.location.search).toBe("");
  });

  it("tk 与 apiKey 同时给出取 tk，不保留 apiKey", () => {
    expect(launch("?tk=t1&apiKey=k1")).toEqual({ type: "token", token: "t1" });
    expect(sessionStorage.length).toBe(1);
  });

  it("先 token 后仅 apiKey 启动：新 key 替换旧 token", () => {
    launch("?tk=t1");
    expect(launch("?apiKey=k2")).toEqual({ type: "apiKey", apiKey: "k2" });
    expect(sessionStorage.getItem("ontology_manager_token")).toBeNull();
  });

  it("先 apiKey 后 tk 启动：新 token 替换旧 key", () => {
    launch("?apiKey=k1");
    expect(launch("?tk=t2")).toEqual({ type: "token", token: "t2" });
    expect(sessionStorage.getItem("ontology_manager_api_key")).toBeNull();
  });

  it("参数出现但值为空：显式清除会话，并移除空参数", () => {
    launch("?tk=t1");
    expect(launch("?tk=&apiKey=&view=assets")).toBeNull();
    expect(sessionStorage.length).toBe(0);
    expect(window.location.search).toBe("?view=assets");
    launch("?apiKey=k1");
    expect(launch("?apiKey")).toBeNull();
  });

  it("完全无参数（刷新）沿用本标签页会话，地址不改写", () => {
    launch("?tk=t1");
    expect(launch("?view=assets", "#/data")).toEqual({ type: "token", token: "t1" });
    expect(window.location.search).toBe("?view=assets");
  });

  it("没有会话凭据时返回应用给定的默认值", () => {
    window.history.replaceState({}, "", "/manager/");
    consumeLaunchCredential();
    expect(sessionCredential({ type: "anonymous" })).toEqual({ type: "anonymous" });
    expect(sessionCredential(null)).toBeNull();
  });

  it("清除只删两个会话键", () => {
    launch("?tk=t1");
    sessionStorage.setItem("other", "x");
    clearSessionCredential();
    expect(sessionStorage.getItem("other")).toBe("x");
    expect(sessionStorage.length).toBe(1);
  });

  it("不读、不写、不删主系统长期 token", () => {
    expect(launch("")).toBeNull();
    launch("?tk=t1");
    launch("?tk=");
    MAIN_TOKEN_KEYS.forEach((key) => expect(localStorage.getItem(key)).toBe(`main-${key}`));
    expect(localStorage.length).toBe(MAIN_TOKEN_KEYS.length);
  });
});
