import { describe, expect, it } from "vitest";

import { marked as serverMarked } from "@ontomato/workbench-server/services/analysis-agent/delivery/marked";
import { renderAgentMarkdown } from "@ontomato/workbench-ui/utils/agent-markdown";
import { marked as webMarked } from "@ontomato/workbench-ui/utils/marked";

// Escaped CJK input keeps the original Markdown punctuation and emphasis behavior.
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
    const source = "53,630.26~60,326.74\uff0c\u65e5\u5360\u6bd4\u57283.08%~3.47%\u4e4b\u95f4\uff0c\u9500\u552e\u91cf\u4ecb\u4e8e50,883.02~67,397.23";

    const html = render(source);

    expect(html).not.toMatch(/<(?:del|s)>/);
    expect(html).toContain("53,630.26~60,326.74");
    expect(html).toContain("3.08%~3.47%");
    expect(html).toContain("50,883.02~67,397.23");
  });

  it("treats only double tildes as strikethrough", () => {
    expect(render("\u4fdd\u7559 ~\u666e\u901a\u6587\u672c~")).toContain("~\u666e\u901a\u6587\u672c~");
    expect(render("\u4fdd\u7559 ~~\u5220\u9664\u7684\u95ee\u9898~~")).toMatch(/<(?:del|s)>\u5220\u9664\u7684\u95ee\u9898<\/(?:del|s)>/);
  });
});

it("renders a single newline identically in backend and frontend Marked", () => {
  expect(serverMarked.parse("first\nsecond")).toBe(webMarked.parse("first\nsecond"));
  expect(serverMarked.parse("first\nsecond")).toContain("first<br>second");
});
