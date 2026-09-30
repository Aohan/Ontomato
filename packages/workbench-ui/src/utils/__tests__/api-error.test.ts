import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { skillsApi } from "../../features/skills/api";
import { nodeApiPost, nodeApiPostFormData } from "../api";
import { installErrorPunctuation } from "../error-punctuation";

describe("web API errors", () => {
  // Distinct app punctuation, so the message shows the details are joined with the installed value.
  beforeEach(() => installErrorPunctuation({ detailSeparator: " — ", listSeparator: " | " }));

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("preserves the backend code and payload for overwrite confirmation", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(409, {
          success: false,
          error: "Skill growth-rate-calc already exists. Overwrite it?",
          code: "SKILL_EXISTS",
          details: { skillId: "growth-rate-calc" },
        })
      )
    );

    const request = nodeApiPostFormData("/skills/import", new FormData());
    await expect(request).rejects.toMatchObject({
      code: "SKILL_EXISTS",
      payload: { details: { skillId: "growth-rate-calc" } },
    });
  });

  it("includes field-level validation details in the frontend error message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(400, {
          success: false,
          error: "Request validation failed",
          details: [{ field: "type", message: "Visualization skills must use the executable type" }],
        })
      )
    );

    await expect(nodeApiPost("/skills", {})).rejects.toThrow(
      "Request validation failed — type: Visualization skills must use the executable type"
    );
  });

  it("rejects the legacy skill-list response shape instead of treating it as empty", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(200, { success: true, data: [] }))
    );

    await expect(skillsApi.listVisualizationSkills()).rejects.toThrow();
  });

  it("only offers executable skills in the visualization selector", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(200, {
          success: true,
          skills: [
            {
              id: "legacy-visualization-knowledge",
              type: "knowledge",
              category: "visualization",
              tags: [],
              enabled: true,
            },
            {
              id: "echarts-render",
              type: "executable",
              category: "visualization",
              tags: ["chart"],
              enabled: true,
            },
          ],
        })
      )
    );

    await expect(skillsApi.listVisualizationSkills()).resolves.toEqual([
      expect.objectContaining({ id: "echarts-render", type: "executable" }),
    ]);
  });
});

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
