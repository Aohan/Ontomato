import { describe, expect, it } from "vitest";
import { renderAgentMarkdown, renderAgentMarkdownWithJsonFormatting } from "../agent-markdown";

describe("agent markdown JSON formatting", () => {
  it.each(['{"status":"ready","steps":[{"type":"query"}]}', '[{"status":"ready"}]'])(
    "formats a complete JSON object or array as a highlighted code block",
    (content) => {
      const html = renderAgentMarkdownWithJsonFormatting(content);

      expect(html).toContain('class="hljs-code-block"');
    }
  );

  it.each(['Explanation text\n{"status":"ready"}', '{"status":', "plain **markdown**", "123"])(
    "keeps non-document JSON content on the existing Markdown path",
    (content) => {
      expect(renderAgentMarkdownWithJsonFormatting(content)).toBe(renderAgentMarkdown(content));
    }
  );
});
