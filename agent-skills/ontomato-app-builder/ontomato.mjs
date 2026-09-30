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

function takeOption(argv, name) {
  const i = argv.indexOf(name);
  if (i < 0) return null;
  if (argv[i + 1] == null) die(`${name} requires a value`);
  const value = argv[i + 1];
  argv.splice(i, 2);
  return value;
}

function takeFlag(argv, name) {
  const i = argv.indexOf(name);
  if (i < 0) return false;
  argv.splice(i, 1);
  return true;
}

function headers(api) {
  return { "Accept-Language": api.lang };
}

function send(api, method, backendPath, body) {
  const h = headers(api);
  let payload;
  if (body !== undefined) {
    h["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  return fetch(`${api.envUrl}/api/data-query${backendPath}`, { method, headers: h, body: payload });
}

async function readJson(res) {
  const text = await res.text();
  if (!res.ok) die(`${res.status}\n${text}`);
  const json = JSON.parse(text);
  if (json.success === false) die(json.message);
  return json;
}

async function requestJson(api, method, backendPath, body) {
  return readJson(await send(api, method, backendPath, body));
}

function printData(json) {
  if (typeof json.data === "string") console.log(json.data);
  else console.log(JSON.stringify(json.data, null, 2));
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

async function ask(api, words) {
  if (words.length === 0) die("ask requires a question");
  const res = await send(api, "POST", "/abcHarness", { question: words.join(" ") });
  if (!res.ok) die(`${res.status}\n${await res.text()}`);
  await printSse(res);
}

// /dsl/executeV1 and /productionEnv/queryData both answer with the DSL result: rows, executed statements and an `error` reason.
async function printDslResult(res) {
  const json = await readJson(res);
  console.log(JSON.stringify(json, null, 2));
  if (json.error != null) process.exit(1);
}

async function distinctValues(api, backendPath, rest) {
  const like = takeOption(rest, "--like");
  const limit = takeOption(rest, "--limit");
  if (rest.length !== 2) die("distinct-values requires <class> <attribute>");
  const body = { className: rest[0], attrName: rest[1], like: like == null ? "" : like };
  if (limit != null) body.limit = Number(limit);
  printData(await requestJson(api, "POST", backendPath, body));
}

async function importTestData(api, file) {
  const form = new FormData();
  form.append("file", new Blob([fs.readFileSync(file)], { type: "application/json" }), path.basename(file));
  const res = await fetch(`${api.envUrl}/api/data-query/testEnv/importData`, {
    method: "POST",
    headers: headers(api),
    body: form,
  });
  await readJson(res);
  console.log("ok");
}

async function vectorUpload(api, argv) {
  const file = takeOption(argv, "--file");
  const text = takeOption(argv, "--text");
  if (text == null) die("vector-upload requires --text <content|@file>");
  if (argv.length !== 3) die("vector-upload requires <class> <attribute> <objectId>");
  const [className, attrName, objectId] = argv;
  const content = readInput(text);
  const form = new FormData();
  form.append("className", className);
  form.append("attrName", attrName);
  form.append("objectId", objectId);
  form.append("content", content);
  if (file != null) {
    const ext = path.extname(file).replace(/^\./, "").toLowerCase();
    form.append("suffix", ext);
    form.append("file", new Blob([fs.readFileSync(file)]), path.basename(file));
  }
  const res = await fetch(`${api.envUrl}/api/data-query/vectorResource/upload`, {
    method: "POST",
    headers: headers(api),
    body: form,
  });
  printData(await readJson(res));
}

async function vectorDelete(api, argv) {
  if (argv.length !== 4) die("vector-delete requires <class> <attribute> <objectId> <path>");
  const [className, attrName, objectId, path] = argv;
  await requestJson(api, "POST", "/vectorResource/delete", { className, attrName, objectId, path });
  console.log("ok");
}

// MetricView (read interface) and Action (write interface) share the same seven endpoints under their own prefix.
async function assetCommand(api, prefix, argv) {
  const sub = argv[0];
  const rest = argv.slice(1);
  if (sub === "generate") {
    const save = takeFlag(rest, "--save");
    if (rest.length === 0) die(`${prefix} generate requires a description`);
    const body = { question: rest.join(" "), persistence: save };
    printData(await requestJson(api, "POST", `/${prefix}/generateFromNatureLanguage`, body));
    return;
  }
  if (sub === "execute") {
    const files = [];
    if (prefix === "action") {
      for (let f = takeOption(rest, "--file"); f != null; f = takeOption(rest, "--file")) files.push(f);
    }
    if (rest[0] == null) die(`${prefix} execute requires an id`);
    // A MetricView or Action without parameters is called with an empty parameter object.
    const param = rest[1] == null ? {} : JSON.parse(readInput(rest[1]));
    if (prefix === "action") {
      // Action execution is a form: `param` travels as a JSON string and each --file is one `file` part,
      // which a vector parameter refers to by its position ("uploadFile": "0").
      const form = new FormData();
      form.append("id", rest[0]);
      form.append("param", JSON.stringify(param));
      for (const f of files) form.append("file", new Blob([fs.readFileSync(f)]), path.basename(f));
      const res = await fetch(`${api.envUrl}/api/data-query/action/execute`, {
        method: "POST",
        headers: headers(api),
        body: form,
      });
      printData(await readJson(res));
      return;
    }
    printData(await requestJson(api, "POST", `/${prefix}/execute`, { id: rest[0], param }));
    return;
  }
  if (sub === "find") {
    if (rest[0] == null) die(`${prefix} find requires a class name`);
    const body = { className: rest[0] };
    if (rest.length > 1) body.question = rest.slice(1).join(" ");
    printData(await requestJson(api, "POST", `/${prefix}/find`, body));
    return;
  }
  if (sub === "get") {
    if (rest[0] == null) die(`${prefix} get requires an id`);
    printData(await requestJson(api, "POST", `/${prefix}/queryById`, { id: rest[0] }));
    return;
  }
  if (sub === "save") {
    if (rest[0] == null) die(`${prefix} save requires a JSON definition`);
    await requestJson(api, "POST", `/${prefix}/save`, JSON.parse(readInput(rest[0])));
    console.log("ok");
    return;
  }
  if (sub === "delete") {
    if (rest[0] == null) die(`${prefix} delete requires an id`);
    await requestJson(api, "POST", `/${prefix}/delete`, { id: rest[0] });
    console.log("ok");
    return;
  }
  usage();
}

function usage() {
  die(`usage: ontomato.mjs [--lang <tag>] <command>
  dataset-desc
  classes
  schema <class> [<class> ...]
  relationships <class> [<class> ...]
  import-schema
  prod-distinct-values <class> <attribute> [--like <pattern>] [--limit <n>]
  prod-query <json|@file>
  prod-knowledge [--max <n>] <question>
  import-test-data <file>
  vector-upload <class> <attribute> <objectId> [--file <path>] --text <text|@file>
  vector-delete <class> <attribute> <objectId> <path>
  distinct-values <class> <attribute> [--like <pattern>] [--limit <n>]
  execute-dsl <json|@file>
  metric-view generate [--save] <description>
  metric-view execute <id> [<param json|@file>]
  metric-view find <class> [<question>]
  metric-view get <id>
  metric-view save <json|@file>
  metric-view delete <id>
  action generate|execute|find|get|save|delete ...   (same arguments as metric-view)
  action execute <id> [<param json|@file>] [--file <path> ...]
  ask <question>`);
}

async function main() {
  const argv = process.argv.slice(2);
  const lang = takeOption(argv, "--lang") ?? "en";
  const cmd = argv[0];
  const cfg = loadConfig();
  if (!cfg.envUrl) die("Set ONTOMATO_URL or envUrl in application.yml");
  const api = { envUrl: cfg.envUrl, lang };
  if (cmd === "dataset-desc") {
    printData(await requestJson(api, "GET", "/admin/getDatasetDesc"));
    return;
  }
  if (cmd === "classes") {
    printData(await requestJson(api, "GET", "/admin/getAllClassNames"));
    return;
  }
  if (cmd === "schema" || cmd === "relationships") {
    const classNames = argv.slice(1);
    if (classNames.length === 0) die(`${cmd} requires at least one class name`);
    const backendPath = cmd === "schema" ? "/admin/getSchemaByClassName" : "/admin/getRelationshipByClassNames";
    printData(await requestJson(api, "POST", backendPath, { classNames }));
    return;
  }
  if (cmd === "import-schema") {
    await requestJson(api, "GET", "/testEnv/importSchema");
    console.log("ok");
    return;
  }
  if (cmd === "prod-distinct-values") {
    await distinctValues(api, "/productionEnv/queryDistinctAttrValue", argv.slice(1));
    return;
  }
  if (cmd === "prod-query") {
    if (argv[1] == null) die("prod-query requires a DSL JSON");
    const dsl = JSON.parse(readInput(argv[1]));
    await printDslResult(await send(api, "POST", "/productionEnv/queryData", { dsl }));
    return;
  }
  if (cmd === "prod-knowledge") {
    const rest = argv.slice(1);
    const max = takeOption(rest, "--max");
    if (rest.length === 0) die("prod-knowledge requires a question");
    const body = { question: rest.join(" ") };
    if (max != null) body.max_result = Number(max);
    printData(await requestJson(api, "POST", "/productionEnv/queryBusinessKnowledge", body));
    return;
  }
  if (cmd === "import-test-data") {
    if (argv[1] == null) die("import-test-data requires a file");
    await importTestData(api, argv[1]);
    return;
  }
  if (cmd === "vector-upload") {
    await vectorUpload(api, argv.slice(1));
    return;
  }
  if (cmd === "vector-delete") {
    await vectorDelete(api, argv.slice(1));
    return;
  }
  if (cmd === "distinct-values") {
    await distinctValues(api, "/admin/queryDistinctAttrValue", argv.slice(1));
    return;
  }
  if (cmd === "execute-dsl") {
    if (argv[1] == null) die("execute-dsl requires a DSL JSON");
    await printDslResult(await send(api, "POST", "/dsl/executeV1", JSON.parse(readInput(argv[1]))));
    return;
  }
  if (cmd === "metric-view") {
    await assetCommand(api, "metricView", argv.slice(1));
    return;
  }
  if (cmd === "action") {
    await assetCommand(api, "action", argv.slice(1));
    return;
  }
  if (cmd === "ask") {
    await ask(api, argv.slice(1));
    return;
  }
  usage();
}

main();
