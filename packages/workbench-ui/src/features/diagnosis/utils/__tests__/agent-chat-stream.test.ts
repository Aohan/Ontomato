import type { DiagnosisStreamEvent } from "@ontomato/contracts/diagnosis";
import type { DiagnosisStreamEvent as BackendDiagnosisStreamEvent } from "@ontomato/contracts/diagnosis";
import { describe, expect, it } from "vitest";

import {
  parseDiagnosisStreamEvent,
  reduceDiagnosisLiveTail,
  type DiagnosisLiveTail,
} from "../agent-chat-stream";

const backendEventFixtures: {
  [Type in BackendDiagnosisStreamEvent["type"]]: Extract<
    BackendDiagnosisStreamEvent,
    { type: Type }
  >;
} = {
  response_unavailable: { type: "response_unavailable" },
  response_started: { type: "response_started", message: "question" },
  token: { type: "token", content: "answer" },
  thinking: { type: "thinking", content: "reason" },
  tool_start: {
    type: "tool_start",
    toolCallId: "call-1",
    tool: "read",
    args: { path: "sample" },
  },
  tool_end: {
    type: "tool_end",
    toolCallId: "call-1",
    tool: "read",
    result: { content: [] },
    isError: false,
  },
  response_end: { type: "response_end", status: "completed" },
  error: { type: "error", error: "failed", timestamp: 1 },
};

function reduce(events: DiagnosisStreamEvent[]): DiagnosisLiveTail {
  return events.reduce(reduceDiagnosisLiveTail, {
    messages: [],
    status: "starting",
  } as DiagnosisLiveTail);
}

describe("diagnosis chat stream reducer", () => {
  it("accepts every backend stream event variant at the frontend boundary", () => {
    for (const event of Object.values(backendEventFixtures)) {
      expect(parseDiagnosisStreamEvent(event)).toEqual(event);
    }
  });

  it("builds one live tail from replayed text, thinking, and tool events", () => {
    const initial: DiagnosisLiveTail = { messages: [], status: "starting" };
    const events: DiagnosisStreamEvent[] = [
      { type: "response_started", message: "inspect" },
      { type: "thinking", content: "checking" },
      { type: "token", content: "found " },
      { type: "token", content: "it" },
      { type: "tool_start", toolCallId: "call-1", tool: "subagent", args: {} },
      {
        type: "tool_end",
        toolCallId: "call-1",
        tool: "subagent",
        result: { status: "completed" },
        isError: false,
      },
      { type: "response_end", status: "completed" },
    ];

    const result = events.reduce(reduceDiagnosisLiveTail, initial);

    expect(initial).toEqual({ messages: [], status: "starting" });
    expect(result).toEqual({
      status: "completed",
      messages: [
        { role: "user", content: "inspect" },
        {
          role: "assistant",
          content: "found it",
          segments: [
            { type: "thinking", content: "checking" },
            { type: "text", content: "found it" },
            {
              type: "tool_call",
              toolCallId: "call-1",
              tool: "subagent",
              args: "{}",
              result: { status: "completed" },
              isError: false,
              status: "done",
            },
          ],
        },
      ],
    });
  });

  it("treats a replayed response start as idempotent and applies terminal states", () => {
    const result = reduce([
      { type: "response_started", message: "same" },
      { type: "response_started", message: "same" },
      { type: "token", content: "partial" },
      { type: "response_end", status: "cancelled" },
    ]);

    expect(result.messages.filter((message) => message.role === "user")).toHaveLength(1);
    expect(result.status).toBe("cancelled");
  });

  it("strictly rejects malformed stream payloads", () => {
    expect(parseDiagnosisStreamEvent({ type: "token", content: 1 })).toBeUndefined();
    expect(
      parseDiagnosisStreamEvent({ type: "tool_start", toolCallId: "1", tool: "read", args: [] })
    ).toBeUndefined();
    expect(
      parseDiagnosisStreamEvent({ type: "response_end", status: "interrupted" })
    ).toBeUndefined();
    expect(parseDiagnosisStreamEvent({ type: "unknown" })).toBeUndefined();
    expect(parseDiagnosisStreamEvent({ type: "response_unavailable" })).toEqual({
      type: "response_unavailable",
    });
  });

  it("clears an unavailable transient tail so durable history can replace it", () => {
    const result = reduce([
      { type: "response_started", message: "question" },
      { type: "token", content: "partial" },
      { type: "response_unavailable" },
    ]);

    expect(result).toEqual({ messages: [], status: "idle" });
  });
});
