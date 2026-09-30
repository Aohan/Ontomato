import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { configureI18n } from "../../../i18n";
import { appTextEn } from "../../../i18n/app-text-en";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import { loadSkills } from "../observe/agent/skill-loader";
import { createBashTool } from "../observe/agent/tools/builtin/bash-tool";
import { createEditTool } from "../observe/agent/tools/builtin/edit-tool";
import { createReadTool } from "../observe/agent/tools/builtin/read-tool";

const BASH_EN =
  "Execute a shell command and return its output (stdout + stderr).Default timeout 60 seconds; output exceeding 256KB is truncated. A working directory can be specified.";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "p3-t2-import-"));

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function writeBadSkill(dir: string) {
  const skillDir = path.join(dir, "demo");
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, "SKILL.md"), '---\nname: demo\ndescription: " "\n---\nbody\n');
}

describe("diagnosis text before configure", () => {
  it("imports without evaluating tool or skill text", () => {
    const empty = path.join(root, "empty-skills");
    const bad = path.join(root, "bad-skills");
    fs.mkdirSync(empty);
    writeBadSkill(bad);
    expect(loadSkills(empty)).toEqual([]);
    expect(() => loadSkills(bad)).toThrow("Workbench i18n is not configured");
    expect(() => createBashTool()).toThrow("Workbench i18n is not configured");
    expect(() => createReadTool()).toThrow("Workbench i18n is not configured");
    expect(() => createEditTool()).toThrow("Workbench i18n is not configured");
  });

  it("reads the OSS description, schema, and read-tool result after assembly", async () => {
    configureI18n({
      defaultLocale: "en",
      languageSwitchEnabled: false,
      appTextLocale: "en",
      packs: { en: { messages: { ...en, ...appTextEn }, ...enLocaleMeta } },
    });

    const bash = createBashTool();
    const parameters = bash.parameters as { properties: { command: { description: string } } };
    expect(bash.name).toBe("bash");
    expect(bash.description).toBe(BASH_EN);
    expect(parameters.properties.command.description).toBe("The shell command to execute");

    const dir = path.join(root, "after-config");
    const bad = path.join(dir, "bad-skills");
    const sample = path.join(dir, "sample.txt");
    const missing = path.join(dir, "missing.txt");
    const editable = path.join(dir, "note.txt");
    fs.mkdirSync(dir);
    writeBadSkill(bad);
    fs.writeFileSync(sample, "a\nb\nc");
    fs.writeFileSync(editable, "alpha\nbeta\ngamma\n");
    const limited = await createReadTool().execute("call-1", { path: sample, limit: 1 });
    const absent = await createReadTool().execute("call-2", { path: missing });
    expect(limited.content[0].text).toBe("1\ta\n\n[2 lines remain in the file. Use offset=2 to continue reading]");
    expect(absent.content[0].text).toBe(`File does not exist: ${missing}`);

    const edited = await createEditTool().execute("call-3", {
      path: editable,
      old_string: "beta",
      new_string: "BETA",
    });
    expect(fs.readFileSync(editable)).toEqual(Buffer.from("alpha\nBETA\ngamma\n"));
    expect(edited.content[0].text).toBe(`Replaced text near line 2 in ${editable}.`);

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(loadSkills(bad)).toEqual([]);
    const text = warn.mock.calls
      .map((call) => call.map((part) => (typeof part === "string" ? part : JSON.stringify(part))).join("\n"))
      .join("\n");
    expect(text).toContain("description is required");
    warn.mockRestore();
  });
});
