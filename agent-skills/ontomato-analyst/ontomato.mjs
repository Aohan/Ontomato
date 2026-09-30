#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));

function die(message) {
  console.error(message);
  process.exit(1);
}

function loadConfig() {
  const text = fs.readFileSync(path.join(DIR, "application.yml"), "utf8");
  const cfg = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const colon = trimmed.indexOf(":");
    if (colon < 0) die(`application.yml line is not key: value: ${trimmed}`);
    cfg[trimmed.slice(0, colon).trim()] = trimmed.slice(colon + 1).trim();
  }
  if (process.env.ONTOMATO_URL) cfg.envUrl = process.env.ONTOMATO_URL;
  return cfg;
}

function readInput(arg) {
  if (arg.startsWith("@")) return fs.readFileSync(arg.slice(1), "utf8");
  return arg;
}

async function request(cfg, method, backendPath, body, headers) {
  const h = { ...headers };
  let payload;
  if (body !== undefined) {
    h["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  return fetch(`${cfg.envUrl}/api/data-query${backendPath}`, {
    method,
    headers: h,
    body: payload,
  });
}

async function requestJson(cfg, method, backendPath, body) {
  const res = await request(cfg, method, backendPath, body, {});
  const text = await res.text();
  if (!res.ok) die(`${res.status}\n${text}`);
  const json = JSON.parse(text);
  if (json.success === false) die(json.message);
  return json;
}

function printEvent(ev) {
  if (ev.error != null) {
    console.error(ev.error);
    process.exit(1);
  }
  if (ev.type === "MESSAGE_TYPE") {
    const content = ev.content;
    console.log(content.message != null ? content.message : content.content);
    return;
  }
  if (ev.type === "DATA_TYPE") {
    console.log(ev.content.question);
    console.log(JSON.stringify(ev.content.data, null, 2));
    return;
  }
  if (ev.sessionId != null && ev.type == null) {
    console.log(`session ${ev.sessionId}`);
    return;
  }
  console.log(JSON.stringify(ev));
}

function printFrame(frame) {
  const lines = [];
  for (const raw of frame.split("\n")) {
    if (!raw || raw.startsWith(":")) continue;
    if (!raw.startsWith("data:")) continue;
    let value = raw.slice(5);
    if (value.startsWith(" ")) value = value.slice(1);
    lines.push(value);
  }
  if (lines.length === 0) return;
  printEvent(JSON.parse(lines.join("\n")));
}

async function printSse(res) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const step = await reader.read();
    if (step.done) break;
    buf += decoder.decode(step.value, { stream: true });
    let cut;
    while ((cut = buf.indexOf("\n\n")) >= 0) {
      const frame = buf.slice(0, cut);
      buf = buf.slice(cut + 2);
      printFrame(frame);
    }
  }
  buf += decoder.decode();
  if (buf.trim()) printFrame(buf);
}

async function ask(cfg, argv) {
  let lang = "en";
  const words = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--lang") {
      i += 1;
      if (argv[i] == null) die("--lang requires a value");
      lang = argv[i];
      continue;
    }
    words.push(argv[i]);
  }
  if (words.length === 0) die("ask requires a question");
  const res = await request(cfg, "POST", "/abcHarness", { question: words.join(" ") }, {
    "Accept-Language": lang,
  });
  if (!res.ok) die(`${res.status}\n${await res.text()}`);
  await printSse(res);
}

function printData(json) {
  if (typeof json.data === "string") console.log(json.data);
  else console.log(JSON.stringify(json.data, null, 2));
}

function takeOption(argv, name) {
  const i = argv.indexOf(name);
  if (i < 0) return null;
  if (argv[i + 1] == null) die(`${name} requires a value`);
  const value = argv[i + 1];
  argv.splice(i, 2);
  return value;
}

async function executeDsl(cfg, arg) {
  const res = await request(cfg, "POST", "/dsl/executeV1", JSON.parse(readInput(arg)), {});
  const text = await res.text();
  if (!res.ok) die(`${res.status}\n${text}`);
  const json = JSON.parse(text);
  console.log(JSON.stringify(json, null, 2));
  if (json.error != null) process.exit(1);
}

function usage() {
  die(`usage:
  ontomato.mjs dataset-desc
  ontomato.mjs classes
  ontomato.mjs schema <class> [<class> ...]
  ontomato.mjs relationships <class> [<class> ...]
  ontomato.mjs distinct-values <class> <attribute> [--like <pattern>] [--limit <n>]
  ontomato.mjs execute-dsl <json|@file>
  ontomato.mjs ask [--lang <tag>] <question>`);
}

async function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const cfg = loadConfig();
  if (!cfg.envUrl) die("Set ONTOMATO_URL or envUrl in application.yml");
  if (cmd === "dataset-desc") {
    printData(await requestJson(cfg, "GET", "/admin/getDatasetDesc"));
    return;
  }
  if (cmd === "classes") {
    printData(await requestJson(cfg, "GET", "/admin/getAllClassNames"));
    return;
  }
  if (cmd === "schema" || cmd === "relationships") {
    const classNames = argv.slice(1);
    if (classNames.length === 0) die(`${cmd} requires at least one class name`);
    const backendPath = cmd === "schema" ? "/admin/getSchemaByClassName" : "/admin/getRelationshipByClassNames";
    printData(await requestJson(cfg, "POST", backendPath, { classNames }));
    return;
  }
  if (cmd === "distinct-values") {
    const rest = argv.slice(1);
    const like = takeOption(rest, "--like");
    const limit = takeOption(rest, "--limit");
    if (rest.length !== 2) die("distinct-values requires <class> <attribute>");
    const body = { className: rest[0], attrName: rest[1], like: like == null ? "" : like };
    if (limit != null) body.limit = Number(limit);
    printData(await requestJson(cfg, "POST", "/admin/queryDistinctAttrValue", body));
    return;
  }
  if (cmd === "execute-dsl") {
    if (argv[1] == null) die("execute-dsl requires a DSL JSON");
    await executeDsl(cfg, argv[1]);
    return;
  }
  if (cmd === "ask") {
    await ask(cfg, argv.slice(1));
    return;
  }
  usage();
}

main();
