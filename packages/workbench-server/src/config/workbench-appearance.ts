import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { WorkbenchAppearance } from "@ontomato/contracts/workbench-appearance";
import { runtimeDataDir } from "../content/layout";

const name = z.string().trim().max(40);
const description = z.string().trim().max(120);
const logo = z
  .string()
  .max(100_000)
  .refine((value) => {
    if (!value) return true;
    if (!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value)) return false;
    const bytes = Buffer.from(value.slice("data:image/png;base64,".length), "base64");
    return (
      bytes.length >= 24 &&
      bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")) &&
      bytes.toString("ascii", 12, 16) === "IHDR" &&
      bytes.readUInt32BE(16) === 128 &&
      bytes.readUInt32BE(20) === 128
    );
  });

export const workbenchAppearanceSchema: z.ZodType<WorkbenchAppearance> = z
  .object({
    brand: z.object({ name, subtitle: description, logo }).strict(),
    qa: z
      .object({
        name,
        description,
        avatarKey: z.enum([
          "",
          "MessageSquare",
          "Brain",
          "Sparkles",
          "Activity",
          "BarChart3",
          "TrendingUp",
          "Target",
          "Database",
          "Wallet",
          "Users",
          "Settings",
        ]),
        avatarColor: z.string().regex(/^(#[0-9a-fA-F]{6})?$/),
      })
      .strict(),
    addAgentLabel: name,
  })
  .strict();

function configFile(domainId: string): string {
  if (!domainId.trim()) throw new Error("domainId is required");
  const key = encodeURIComponent(domainId).replace(/\./g, "%2E");
  return runtimeDataDir("workbench-appearance", `${key}.json`);
}

export async function getWorkbenchAppearance(domainId: string): Promise<WorkbenchAppearance> {
  try {
    return workbenchAppearanceSchema.parse(
      JSON.parse(await readFile(configFile(domainId), "utf8"))
    );
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
    return {
      brand: { name: "", subtitle: "", logo: "" },
      qa: { name: "", description: "", avatarKey: "", avatarColor: "" },
      addAgentLabel: "",
    };
  }
}

export async function saveWorkbenchAppearance(
  domainId: string,
  value: WorkbenchAppearance
): Promise<void> {
  const file = configFile(domainId);
  const temporary = `${file}.${randomUUID()}.tmp`;
  await mkdir(path.dirname(file), { recursive: true });
  try {
    await writeFile(temporary, JSON.stringify(value), "utf8");
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
}
