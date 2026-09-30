import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createManagerClient,
  type ManagerAuthFailureStatus,
  type ManagerCredential,
  type ManagerRequestContext,
} from "../api";
import { englishMessages } from "../i18n";

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

/** Host-supplied data defaults that differ from the open-source values, so the tests can tell which one was used. */
const hostFallbacks = { noBusinessDescription: "Host: no description", unnamedAsset: "Host: unnamed asset" };

function setup(credential: ManagerCredential | null) {
  const context: { -readonly [K in keyof ManagerRequestContext]: ManagerRequestContext[K] } = {
    apiBase: "/custom/manager-api",
    credential,
    locale: "en",
    messages: englishMessages,
    dataFallbacks: hostFallbacks,
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

describe("credentials and request headers", () => {
  it("a token sends only tk and paths use the host apiBase", async () => {
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

  it("an API key sends only x-api-key", async () => {
    const { client } = setup({ type: "apiKey", apiKey: "k-1" });
    await client.loadSmartAssets("metrics");

    expect(requests[0].url).toBe("/custom/manager-api/data-query/metricView/queryList");
    expect(requests[0].headers["x-api-key"]).toBe("k-1");
    expect(requests[0].headers).not.toHaveProperty("tk");
  });

  it("explicit anonymous sends no credential headers", async () => {
    const { client } = setup({ type: "anonymous" });
    await client.loadOntology();

    expect(requests[0].headers).not.toHaveProperty("tk");
    expect(requests[0].headers).not.toHaveProperty("x-api-key");
  });

  it("a missing or cleared credential sends no request and does not fall back to anonymous", async () => {
    const { client } = setup(null);

    await expect(client.loadOntology()).rejects.toThrow();
    expect(requests).toHaveLength(0);
  });

  it("after replacing the credential and locale, later requests use the new values immediately", async () => {
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

describe("stale responses and authentication failures", () => {
  it("after dispose no request is sent and in-flight responses are not delivered (stale follow-ups after the workspace unmounts)", async () => {
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

  it("a credential change during the request drops the response without delivering data", async () => {
    const pending = deferred();
    respond = () => pending.promise;
    const { context, client } = setup({ type: "token", token: "old" });
    const result = client.loadOntology();
    context.credential = { type: "token", token: "new" };
    pending.resolve(json({ success: true, data: { classDef: [{ className: "stale" }] } }));

    await expect(result).rejects.toMatchObject({ name: "AbortError" });
  });

  it("clearing the credential during the request also drops the response", async () => {
    const pending = deferred();
    respond = () => pending.promise;
    const { context, client } = setup({ type: "apiKey", apiKey: "k" });
    const result = client.loadSmartAssets("tasks");
    context.credential = null;
    pending.resolve(json({ success: true, data: [] }));

    await expect(result).rejects.toMatchObject({ name: "AbortError" });
  });

  it("a 401 for the old credential does not notify the host, so the new session is not affected", async () => {
    const pending = deferred();
    respond = () => pending.promise;
    const { context, client, failures } = setup({ type: "token", token: "old" });
    const result = client.loadOntology();
    context.credential = { type: "token", token: "new" };
    pending.resolve(json({}, 401));

    await expect(result).rejects.toMatchObject({ name: "AbortError" });
    expect(failures).toEqual([]);
  });

  it("with the same credential but a new apiBase, a successful response from the old source is dropped", async () => {
    const pending = deferred();
    respond = () => pending.promise;
    const { context, client } = setup({ type: "anonymous" });
    const result = client.loadObjectData("Order", 1, 25);
    context.apiBase = "/other-api";
    pending.resolve(json({ success: true, data: [{ id: "old-source" }], total_count: 1 }));

    await expect(result).rejects.toMatchObject({ name: "AbortError" });
  });

  it("with the same credential but a new apiBase, a 401 from the old source does not notify the new host", async () => {
    const pending = deferred();
    respond = () => pending.promise;
    const { context, client, failures } = setup({ type: "anonymous" });
    const result = client.getBusinessConfig();
    context.apiBase = "/other-api";
    pending.resolve(json({}, 401));

    await expect(result).rejects.toMatchObject({ name: "AbortError" });
    expect(failures).toEqual([]);
  });

  // The original main system (c0287200 web/src/utils/api.ts) sent the current locale on every request and checked results by credential only; a locale change does not invalidate results for the same identity.
  it("switching only the locale before the response arrives: the same identity's result is delivered and the next request carries the new locale", async () => {
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

  it("switching only the locale while reading JSON still delivers; changing locale and credential together still drops", async () => {
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

  it("a context change while reading JSON also withholds the data", async () => {
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

  it("recreating a credential object with the same value is not a context change", async () => {
    const pending = deferred();
    respond = () => pending.promise;
    const { context, client } = setup({ type: "token", token: "same" });
    const result = client.loadObjectData("Order", 1, 25);
    context.credential = { type: "token", token: "same" };
    pending.resolve(json({ success: true, data: [{ id: 1 }], total_count: "3" }));

    await expect(result).resolves.toEqual({ rows: [{ id: 1 }], total: 3 });
  });

  it.each([401, 402] as const)("%i only notifies the host and leaves the supplied credential unchanged", async (status) => {
    respond = async () => json({}, status);
    const { context, client, failures } = setup({ type: "token", token: "t" });

    await expect(client.loadOntology()).rejects.toThrow(String(status));
    expect(failures).toEqual([status]);
    expect(context.credential).toEqual({ type: "token", token: "t" });
  });

  it("other error statuses do not notify the host", async () => {
    respond = async () => json({}, 500);
    const { client, failures } = setup({ type: "token", token: "t" });

    await expect(client.loadOntology()).rejects.toThrow("500");
    expect(failures).toEqual([]);
  });

  it("business failures throw message/error", async () => {
    respond = async () => json({ success: false, error: "Class does not exist" });
    const { client } = setup({ type: "token", token: "t" });

    await expect(client.deleteOntologyObject("X")).rejects.toThrow("Class does not exist");
  });
});

describe("requests used by data browsing and visual modeling", () => {
  it("business config is read with GET and no body", async () => {
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

  it("paged data submits search only when a keyword is given", async () => {
    const { client } = setup({ type: "token", token: "t" });
    await client.loadObjectData("Order", 2, 50, "abc");
    await client.loadObjectData("Order", 1, 25);

    expect(requests.map((r) => r.body)).toEqual([
      { classname: "Order", pagenum: 2, pagecount: 50, search: "abc" },
      { classname: "Order", pagenum: 1, pagecount: 25 },
    ]);
  });

  it("creating classes and relations in modeling keeps the original request body fields", async () => {
    const { client } = setup({ type: "token", token: "t" });
    await client.createOntologyObject({
      className: "Order",
      primaryKeyName: "order_no",
      showName: "Sales Order",
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
          primaryKeyName: "order_no",
          showName: "Sales Order",
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

  it("object-form relations and string booleans in metadata are parsed by the original rules", async () => {
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
    // The fallback comes from the host-supplied value, not from the UI locale.
    const { client } = setup({ type: "token", token: "t" });

    await expect(client.loadOntology()).resolves.toEqual({
      objects: [
        {
          className: "Order",
          showName: "Order",
          classDesc: "Host: no description",
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

  it("both data defaults come from the host: empty descriptions and non-string names fall back, empty-string names are kept, independent of the UI locale", async () => {
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
