import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createManagerClient,
  type ManagerAuthFailureStatus,
  type ManagerCredential,
  type ManagerRequestContext,
} from "../api";

interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

let requests: RecordedRequest[];
let respond: (url: string) => Promise<Response>;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

beforeEach(() => {
  requests = [];
  respond = async () => json({ success: true, data: {} });
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    requests.push({
      url,
      method: String(init.method),
      headers: init.headers as Record<string, string>,
      body: init.body === undefined ? undefined : JSON.parse(String(init.body)),
    });
    return respond(url);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** 企业固定源 c0287200 ontology-manager/src/api.ts:118、:322 的原值。 */
const enterpriseFallbacks = { noBusinessDescription: "未填写业务说明", unnamedAsset: "未命名资产" };

function setup(credential: ManagerCredential | null) {
  const context: { -readonly [K in keyof ManagerRequestContext]: ManagerRequestContext[K] } = {
    apiBase: "/custom/manager-api",
    credential,
    locale: "en",
    dataFallbacks: enterpriseFallbacks,
  };
  const failures: ManagerAuthFailureStatus[] = [];
  const client = createManagerClient(context, (status) => failures.push(status));
  return { context, client, failures };
}

function deferred() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((r) => (resolve = r));
  return { promise, resolve };
}

describe("凭据与请求头", () => {
  it("token 只发 tk，路径使用宿主 apiBase", async () => {
    const { client } = setup({ type: "token", token: "t-1" });
    await client.loadOntology();

    expect(requests[0].url).toBe("/custom/manager-api/data-query/admin/getMetas");
    expect(requests[0].method).toBe("POST");
    expect(requests[0].headers).toEqual({
      "Content-Type": "application/json",
      "Accept-Language": "en",
      "X-Requested-With": "XMLHttpRequest",
      tk: "t-1",
    });
  });

  it("API Key 只发 x-api-key", async () => {
    const { client } = setup({ type: "apiKey", apiKey: "k-1" });
    await client.loadSmartAssets("metrics");

    expect(requests[0].url).toBe("/custom/manager-api/data-query/metricView/queryList");
    expect(requests[0].headers["x-api-key"]).toBe("k-1");
    expect(requests[0].headers).not.toHaveProperty("tk");
  });

  it("明确匿名不带任何凭据头", async () => {
    const { client } = setup({ type: "anonymous" });
    await client.loadOntology();

    expect(requests[0].headers).not.toHaveProperty("tk");
    expect(requests[0].headers).not.toHaveProperty("x-api-key");
  });

  it("凭据缺失或清除时不发请求，也不退回匿名", async () => {
    const { client } = setup(null);

    await expect(client.loadOntology()).rejects.toThrow();
    expect(requests).toHaveLength(0);
  });

  it("替换凭据与语言后，后续请求立即使用新值", async () => {
    const { context, client } = setup({ type: "token", token: "t-1" });
    await client.loadOntology();
    context.credential = { type: "apiKey", apiKey: "k-2" };
    context.locale = "zh-CN";
    await client.loadOntology();
    context.credential = { type: "anonymous" };
    await client.loadOntology();
    context.credential = null;
    await expect(client.loadOntology()).rejects.toThrow();

    expect(requests.map((r) => [r.headers.tk, r.headers["x-api-key"]])).toEqual([
      ["t-1", undefined],
      [undefined, "k-2"],
      [undefined, undefined],
    ]);
    expect(requests[1].headers["Accept-Language"]).toBe("zh-CN");
  });
});

describe("旧响应与认证失败", () => {
  it("dispose 后不再发请求，在途响应也不交付（工作区卸载后的旧后续）", async () => {
    const pending = deferred();
    respond = () => pending.promise;
    const { client } = setup({ type: "token", token: "t" });
    const inFlight = client.loadOntology();
    client.dispose();
    pending.resolve(json({ success: true, data: { classDef: [{ className: "stale" }] } }));
    await expect(inFlight).rejects.toMatchObject({ name: "AbortError" });

    const before = requests.length;
    await expect(client.deleteOntologyObject("Order")).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(requests.length).toBe(before);
  });

  it("请求期间凭据变化则丢弃响应，不交付数据", async () => {
    const pending = deferred();
    respond = () => pending.promise;
    const { context, client } = setup({ type: "token", token: "old" });
    const result = client.loadOntology();
    context.credential = { type: "token", token: "new" };
    pending.resolve(json({ success: true, data: { classDef: [{ className: "stale" }] } }));

    await expect(result).rejects.toMatchObject({ name: "AbortError" });
  });

  it("请求期间凭据被清除也丢弃响应", async () => {
    const pending = deferred();
    respond = () => pending.promise;
    const { context, client } = setup({ type: "apiKey", apiKey: "k" });
    const result = client.loadSmartAssets("tasks");
    context.credential = null;
    pending.resolve(json({ success: true, data: [] }));

    await expect(result).rejects.toMatchObject({ name: "AbortError" });
  });

  it("旧凭据的 401 不通知宿主，避免误伤新会话", async () => {
    const pending = deferred();
    respond = () => pending.promise;
    const { context, client, failures } = setup({ type: "token", token: "old" });
    const result = client.loadOntology();
    context.credential = { type: "token", token: "new" };
    pending.resolve(json({}, 401));

    await expect(result).rejects.toMatchObject({ name: "AbortError" });
    expect(failures).toEqual([]);
  });

  it("凭据不变但 apiBase 变化时丢弃旧来源的成功响应", async () => {
    const pending = deferred();
    respond = () => pending.promise;
    const { context, client } = setup({ type: "anonymous" });
    const result = client.loadObjectData("Order", 1, 25);
    context.apiBase = "/other-api";
    pending.resolve(json({ success: true, data: [{ id: "old-source" }], total_count: 1 }));

    await expect(result).rejects.toMatchObject({ name: "AbortError" });
  });

  it("凭据不变但 apiBase 变化时旧来源的 401 不通知新宿主", async () => {
    const pending = deferred();
    respond = () => pending.promise;
    const { context, client, failures } = setup({ type: "anonymous" });
    const result = client.getBusinessConfig();
    context.apiBase = "/other-api";
    pending.resolve(json({}, 401));

    await expect(result).rejects.toMatchObject({ name: "AbortError" });
    expect(failures).toEqual([]);
  });

  // 原主系统（c0287200 web/src/utils/api.ts）每次请求取当前语言作请求头，只按凭据核对结果；语言变化不作废同一身份的结果。
  it("响应返回前只切换语言：同一身份的结果照常交付，下一次请求带新语言", async () => {
    const pending = deferred();
    respond = () => pending.promise;
    const { context, client } = setup({ type: "token", token: "t" });
    const result = client.loadSmartAssets("metrics");
    context.locale = "zh-CN";
    pending.resolve(json({ success: true, data: [{ name: "en-request" }] }));

    await expect(result).resolves.toEqual([expect.objectContaining({ name: "en-request" })]);
    respond = async () => json({ success: true, data: [] });
    await client.loadSmartAssets("metrics");
    expect(requests.map((r) => r.headers["Accept-Language"])).toEqual(["en", "zh-CN"]);
  });

  it("读取 JSON 期间只切换语言也照常交付；语言与凭据同时变化仍丢弃", async () => {
    let finishBody!: (body: unknown) => void;
    let bodyRequested!: () => void;
    const reading = () => new Promise<void>((resolve) => (bodyRequested = resolve));
    respond = async () =>
      ({
        ok: true,
        status: 200,
        json: () => {
          bodyRequested();
          return new Promise((resolve) => (finishBody = resolve));
        },
      }) as unknown as Response;
    const { context, client } = setup({ type: "token", token: "t" });

    let started = reading();
    const kept = client.getMetas();
    await started;
    context.locale = "zh-CN";
    finishBody({ success: true, data: { classDef: [{ className: "Order" }] } });
    await expect(kept).resolves.toMatchObject({ data: { classDef: [{ className: "Order" }] } });

    started = reading();
    const dropped = client.getMetas();
    await started;
    context.locale = "en";
    context.credential = { type: "token", token: "other" };
    finishBody({ success: true, data: { classDef: [] } });
    await expect(dropped).rejects.toMatchObject({ name: "AbortError" });
  });

  it("读取 JSON 期间上下文变化也不交付数据", async () => {
    let finishBody!: (body: unknown) => void;
    let bodyRequested!: () => void;
    const reading = new Promise<void>((resolve) => (bodyRequested = resolve));
    const body = new Promise<unknown>((resolve) => (finishBody = resolve));
    const json = () => {
      bodyRequested();
      return body;
    };
    respond = async () => ({ ok: true, status: 200, json }) as unknown as Response;
    const { context, client } = setup({ type: "token", token: "t" });
    const result = client.getMetas();
    await reading;
    context.apiBase = "/other-api";
    finishBody({ success: true, data: { classDef: [] } });

    await expect(result).rejects.toMatchObject({ name: "AbortError" });
  });

  it("同值凭据对象重建不算上下文变化", async () => {
    const pending = deferred();
    respond = () => pending.promise;
    const { context, client } = setup({ type: "token", token: "same" });
    const result = client.loadObjectData("Order", 1, 25);
    context.credential = { type: "token", token: "same" };
    pending.resolve(json({ success: true, data: [{ id: 1 }], total_count: "3" }));

    await expect(result).resolves.toEqual({ rows: [{ id: 1 }], total: 3 });
  });

  it.each([401, 402] as const)("%i 只通知宿主，不改动传入的凭据", async (status) => {
    respond = async () => json({}, status);
    const { context, client, failures } = setup({ type: "token", token: "t" });

    await expect(client.loadOntology()).rejects.toThrow(String(status));
    expect(failures).toEqual([status]);
    expect(context.credential).toEqual({ type: "token", token: "t" });
  });

  it("其他错误状态不通知宿主", async () => {
    respond = async () => json({}, 500);
    const { client, failures } = setup({ type: "token", token: "t" });

    await expect(client.loadOntology()).rejects.toThrow("500");
    expect(failures).toEqual([]);
  });

  it("业务失败按 message/error 抛出", async () => {
    respond = async () => json({ success: false, error: "类不存在" });
    const { client } = setup({ type: "token", token: "t" });

    await expect(client.deleteOntologyObject("X")).rejects.toThrow("类不存在");
  });
});

describe("数据浏览与可视化建模所需的请求", () => {
  it("业务配置用 GET 读取，不带请求体", async () => {
    respond = async () => json({ success: true, data: { dataAdapter: "postgres" } });
    const { client } = setup({ type: "apiKey", apiKey: "k" });

    const config = await client.getBusinessConfig();

    expect(config.data.dataAdapter).toBe("postgres");
    expect(requests[0]).toMatchObject({
      url: "/custom/manager-api/data-query/businessConfig/getConfig",
      method: "GET",
      body: undefined,
    });
    expect(requests[0].headers).not.toHaveProperty("Content-Type");
    expect(requests[0].headers["x-api-key"]).toBe("k");
  });

  it("分页数据仅在有关键词时提交 search", async () => {
    const { client } = setup({ type: "token", token: "t" });
    await client.loadObjectData("Order", 2, 50, "abc");
    await client.loadObjectData("Order", 1, 25);

    expect(requests.map((r) => r.body)).toEqual([
      { classname: "Order", pagenum: 2, pagecount: 50, search: "abc" },
      { classname: "Order", pagenum: 1, pagecount: 25 },
    ]);
  });

  it("建模新建类与关系保留原请求体字段", async () => {
    const { client } = setup({ type: "token", token: "t" });
    await client.createOntologyObject({
      className: "Order",
      showName: "订单",
      classDesc: "d",
      classToCard: false,
      instanceToCard: false,
      inStarChart: false,
    });
    await client.createOntologyRelation({
      relationship: "has",
      fromclass: "A",
      toclass: "B",
      desc: "d",
      fromField: "a_id",
      toField: "id",
    });
    await client.createOntologyRelation({
      relationship: "r",
      fromclass: "A",
      toclass: "B",
      desc: "",
    });

    expect(
      requests.map((r) => [r.url.replace("/custom/manager-api/data-query", ""), r.body])
    ).toEqual([
      [
        "/admin/addClass",
        {
          className: "Order",
          showName: "订单",
          classDesc: "d",
          classToCard: false,
          instanceToCard: false,
          inStarChart: false,
        },
      ],
      [
        "/admin/addRelationship",
        {
          relationName: "has",
          fromClassName: "A",
          toClassName: "B",
          relationDesc: "d",
          fromField: "a_id",
          toField: "id",
        },
      ],
      [
        "/admin/addRelationship",
        { relationName: "r", fromClassName: "A", toClassName: "B", relationDesc: "" },
      ],
    ]);
  });

  it("元数据的对象形式关系与字符串布尔按原规则解析", async () => {
    respond = async () =>
      json({
        success: true,
        data: {
          classDef: [
            {
              className: "Order",
              attrs: [{ name: "id", bizzkey: " TRUE ", primary_key: "true", enable: "false" }],
            },
          ],
          relationship_rule: { has: { fromclass: "Order", toclass: "Item" } },
        },
      });
    // 界面语言为 en 时，兜底仍取宿主装配的企业原值。
    const { client } = setup({ type: "token", token: "t" });

    await expect(client.loadOntology()).resolves.toEqual({
      objects: [
        {
          className: "Order",
          showName: "Order",
          classDesc: "未填写业务说明",
          attrs: [
            {
              name: "id",
              showName: "id",
              type: "string",
              attrDesc: "",
              enable: false,
              bizzkeyBool: true,
              primaryKey: true,
            },
          ],
        },
      ],
      relations: [
        { relationship: "has", showName: "has", fromclass: "Order", toclass: "Item", desc: "has" },
      ],
    });
  });

  it("两个数据默认值取宿主装配值：空说明与非字符串名称兜底，空字符串名称保留，与界面语言无关", async () => {
    respond = async (url) =>
      url.endsWith("/admin/getMetas")
        ? json({ success: true, data: { classDef: [{ className: "A", classDesc: "" }] } })
        : json({
            success: true,
            data: [{ id: "f1", name: "" }, { id: "f2" }, { id: "f3", name: 7 }],
          });
    const oss = {
      noBusinessDescription: "No business description provided",
      unnamedAsset: "Unnamed asset",
    };
    const { client, context } = setup({ type: "token", token: "t" });
    context.dataFallbacks = oss;
    context.locale = "zh-CN";

    const { objects } = await client.loadOntology();
    expect(objects[0].classDesc).toBe("No business description provided");
    const assets = await client.loadSmartAssets("functions");
    expect(assets.map((asset) => asset.name)).toEqual(["", "Unnamed asset", "Unnamed asset"]);
  });
});
