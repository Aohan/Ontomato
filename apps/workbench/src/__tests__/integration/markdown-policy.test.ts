import { describe, expect, it } from "vitest";

import { marked as serverMarked } from "@ontomato/workbench-server/services/analysis-agent/delivery/marked";
import { renderAgentMarkdown } from "@ontomato/workbench-ui/utils/agent-markdown";
import { marked as webMarked } from "@ontomato/workbench-ui/utils/marked";

const renderers = [
  {
    name: "server marked",
    render: (source: string) => serverMarked.parse(source) as string,
  },
  {
    name: "web marked",
    render: (source: string) => webMarked.parse(source) as string,
  },
  {
    name: "web markdown-it",
    render: renderAgentMarkdown,
  },
];

describe.each(renderers)("$name product Markdown dialect", ({ render }) => {
  it("keeps repeated single-tilde numeric ranges literal", () => {
    const source = "53,630.26~60,326.74，日占比在3.08%~3.47%之间，销售量介于50,883.02~67,397.23";

    const html = render(source);

    expect(html).not.toMatch(/<(?:del|s)>/);
    expect(html).toContain("53,630.26~60,326.74");
    expect(html).toContain("3.08%~3.47%");
    expect(html).toContain("50,883.02~67,397.23");
  });

  it("treats only double tildes as strikethrough", () => {
    expect(render("保留 ~普通文本~")).toContain("~普通文本~");
    expect(render("保留 ~~删除的问题~~")).toMatch(/<(?:del|s)>删除的问题<\/(?:del|s)>/);
  });
});

it("renders a single newline identically in backend and frontend Marked", () => {
  expect(serverMarked.parse("first\nsecond")).toBe(webMarked.parse("first\nsecond"));
  expect(serverMarked.parse("first\nsecond")).toContain("first<br>second");
});
