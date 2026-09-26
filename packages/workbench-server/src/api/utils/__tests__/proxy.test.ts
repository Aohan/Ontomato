import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { proxyResponse, proxyUpstream } from "../proxy";

let servers: http.Server[] = [];

afterEach(async () => {
  const current = servers;
  servers = [];
  await Promise.all(
    current.map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        })
    )
  );
});

describe("proxyResponse", () => {
  it("forwards the first SSE chunk before the upstream ends", async () => {
    let release!: () => void;
    let upstreamEnded = false;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const encode = (chunk: string) => new TextEncoder().encode(chunk);
    const upstream = new Response(
      new ReadableStream({
        async start(controller) {
          controller.enqueue(encode("data: one\n\n"));
          await gate;
          controller.enqueue(encode("data: two\n\n"));
          controller.close();
          upstreamEnded = true;
        },
      }),
      { status: 200, headers: { "content-type": "text/event-stream;charset=UTF-8" } }
    );

    const response = await fetch(await listen("/sse", upstream));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream;charset=UTF-8");
    const reader = response.body!.getReader();
    const decode = (value?: Uint8Array) => new TextDecoder().decode(value);
    expect(decode((await reader.read()).value)).toBe("data: one\n\n");
    expect(upstreamEnded).toBe(false);
    release();
    expect(decode((await reader.read()).value)).toBe("data: two\n\n");
    expect((await reader.read()).done).toBe(true);
  });

  it("ends the response when the upstream errors after the first chunk", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const upstream = new Response(
      new ReadableStream({
        async start(controller) {
          controller.enqueue(new TextEncoder().encode("data: one\n\n"));
          await gate;
          controller.error(new Error("upstream dropped"));
        },
      }),
      { headers: { "content-type": "text/event-stream" } }
    );

    const response = await fetch(await listen("/sse", upstream));
    const reader = response.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe("data: one\n\n");
    release();
    expect((await reader.read()).done).toBe(true);
  });

  it("returns a non-SSE response unchanged", async () => {
    const upstream = new Response('{"ok":true}', {
      status: 201,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
    const response = await fetch(await listen("/json", upstream));
    expect(response.status).toBe(201);
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(await response.json()).toEqual({ ok: true });
  });
});

describe("proxyUpstream", () => {
  it("forwards a multipart upload with its boundary unchanged", async () => {
    let received: { contentType?: string; body: string } | null = null;
    const upstream = express();
    upstream.post("/testEnv/importData", async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      received = {
        contentType: req.headers["content-type"],
        body: Buffer.concat(chunks).toString(),
      };
      res.json({ success: true });
    });
    const upstreamBase = await serve(upstream);

    const form = new FormData();
    form.append(
      "file",
      new Blob(['{"objDatas":[]}'], { type: "application/json" }),
      "testData.json"
    );
    const response = await fetch(`${await proxyApp(upstreamBase)}/testEnv/importData`, {
      method: "POST",
      body: form,
    });

    expect(await response.json()).toEqual({ success: true });
    expect(received!.contentType).toMatch(/^multipart\/form-data; boundary=/);
    const boundary = received!.contentType!.split("boundary=")[1];
    expect(received!.body).toContain(`--${boundary}`);
    expect(received!.body).toContain('filename="testData.json"');
    expect(received!.body).toContain('{"objDatas":[]}');
  });

  it("forwards a JSON body as JSON", async () => {
    let received: { contentType?: string; body: unknown } | null = null;
    const upstream = express();
    upstream.use(express.json());
    upstream.post("/dsl/executeV1", (req, res) => {
      received = { contentType: req.headers["content-type"], body: req.body };
      res.json({ success: true });
    });
    const upstreamBase = await serve(upstream);

    await fetch(`${await proxyApp(upstreamBase)}/dsl/executeV1`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ problem: "p" }),
    });

    expect(received!.contentType).toBe("application/json");
    expect(received!.body).toEqual({ problem: "p" });
  });
});

function listen(path: string, upstream: Response): Promise<string> {
  const app = express();
  app.get(path, (_req, res) => {
    void proxyResponse(upstream, res);
  });
  return serve(app).then((base) => `${base}${path}`);
}

function proxyApp(upstreamBase: string): Promise<string> {
  const app = express();
  app.use(express.json());
  app.use("/", (req, res) => {
    void proxyUpstream(req, res, upstreamBase, req.path);
  });
  return serve(app);
}

function serve(app: express.Express): Promise<string> {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve(`http://127.0.0.1:${port}`);
    });
    servers.push(server);
  });
}
