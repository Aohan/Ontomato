import type {
  Flowchart,
  FlowchartNode,
  FlowchartEdge,
  ParsedLogRecord,
  TimelineEvent,
} from "@ontomato/contracts/observe";
/**
 * Timeline and flowchart builder.
 *
 * Constructs a chronological timeline of events from parsed logs,
 * and derives a flowchart (nodes + edges) from the timeline.
 */

/* ================================================================== */
/*  Timeline                                                          */
/* ================================================================== */

/**
 * Build a chronological timeline from parsed log records.
 *
 * Infers node_start/node_end events from app logs with context patterns
 * like "[router-node]", "[planner-node]", etc. LLM calls are added as
 * separate events.
 */
export function buildTimeline(records: ParsedLogRecord[]): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  for (const record of records) {
    if (record.source === "llm") {
      events.push(buildLlmEvent(record));
    } else {
      const nodeEvent = inferNodeEvent(record);
      if (nodeEvent) {
        events.push(nodeEvent);
      } else if (record.level === "error") {
        events.push({
          time: record.time || new Date().toISOString(),
          source: record.source,
          type: "error",
          name: "error",
          detail: record.message,
        });
      }
    }
  }

  // Sort by time
  events.sort((a, b) => a.time.localeCompare(b.time));

  return events;
}

/**
 * Build a flowchart from a timeline.
 *
 * Groups timeline events by node name, computes durations,
 * determines success/error status, and creates edges based on
 * temporal ordering.
 */
export function buildFlowchart(timeline: TimelineEvent[]): Flowchart {
  // Collect unique node names (preserving temporal order of first appearance)
  const nodeMap = new Map<
    string,
    {
      startTime?: string;
      endTime?: string;
      status: FlowchartNode["status"];
      error?: string;
      durationMs?: number;
    }
  >();

  for (const event of timeline) {
    const name = event.name;
    if (!name || name === "error") continue;

    if (!nodeMap.has(name)) {
      nodeMap.set(name, {
        status: "pending",
      });
    }

    const node = nodeMap.get(name)!;

    if (event.type === "node_start") {
      node.startTime = event.time;
    } else if (event.type === "node_end") {
      node.endTime = event.time;
      node.status = event.status === "error" ? "error" : "success";
      if (event.durationMs !== undefined) {
        node.durationMs = event.durationMs;
      } else if (node.startTime && node.endTime) {
        node.durationMs = new Date(node.endTime).getTime() - new Date(node.startTime).getTime();
      }
    } else if (event.type === "error") {
      node.status = "error";
      node.error = event.detail;
    } else if (event.type === "llm_call") {
      // LLM calls don't change node status but may indicate activity.
      if (node.status === "pending") {
        node.status = event.status === "error" ? "error" : "success";
      }
      if (event.durationMs !== undefined) {
        node.durationMs = (node.durationMs || 0) + event.durationMs;
      }
    }
  }

  // Build nodes
  const nodes: FlowchartNode[] = [];
  const nodeNames: string[] = [];
  for (const [name, data] of nodeMap) {
    nodeNames.push(name);
    nodes.push({
      id: name,
      label: humanizeNodeName(name),
      status: data.status,
      durationMs: data.durationMs,
      startTime: data.startTime,
      endTime: data.endTime,
      error: data.error,
    });
  }

  // Detect parallel groups: nodes whose time ranges overlap
  const parallelGroups = detectParallelGroups(nodeMap);

  // Build edges: sequential edges with parallel group awareness
  const edges: FlowchartEdge[] = [];
  const inParallelGroup = new Set(parallelGroups.flatMap((g) => g));
  let i = 0;
  while (i < nodeNames.length - 1) {
    const current = nodeNames[i];
    const group = parallelGroups.find((g) => g.includes(current));

    if (group) {
      // For parallel nodes, connect predecessor -> each parallel node -> successor
      const groupEnd = Math.max(...group.map((n) => nodeNames.indexOf(n)));
      const successor = nodeNames[groupEnd + 1];
      const predecessor = i > 0 ? nodeNames[i - 1] : null;

      for (const pNode of group) {
        if (predecessor && !inParallelGroup.has(predecessor)) {
          edges.push({ from: predecessor, to: pNode });
        }
        if (successor) {
          edges.push({ from: pNode, to: successor });
        }
      }
      i = groupEnd + 1;
    } else {
      edges.push({ from: nodeNames[i], to: nodeNames[i + 1] });
      i++;
    }
  }

  // Correlate error events to specific nodes
  for (const event of timeline) {
    if (event.type === "error" && event.name === "error" && event.detail) {
      const matchedNode = correlateErrorToNode(event, nodes);
      if (matchedNode && !matchedNode.error) {
        matchedNode.error = event.detail;
        if (matchedNode.status !== "error") {
          matchedNode.status = "error";
        }
      }
    }
  }

  return { nodes, edges };
}

/* ================================================================== */
/*  Internal helpers                                                  */
/* ================================================================== */

/**
 * Well-known node names from the data-agent LangGraph workflow.
 */
const KNOWN_NODES = new Set([
  "router",
  "router-node",
  "clarification",
  "clarification-node",
  "planner",
  "planner-node",
  "query",
  "query-node",
  "analysis",
  "analysis-node",
  "analysis-agent",
  "analysis-agent-node",
  "deep-analysis-response",
  "deep-analysis-response-node",
  "visualization",
  "visualization-node",
  "response",
  "response-node",
  "multi-dim-summary",
  "multi-dim-summary-node",
]);

/**
 * Infer a node event from an app log record.
 *
 * Patterns detected:
 * - "[router-node] Router LLM input length" -> node_start
 * - "Workflow node completed" with nodeName -> node_end
 * - Node error patterns
 */
function inferNodeEvent(record: ParsedLogRecord): TimelineEvent | null {
  const msg = record.message;
  if (!msg) return null;

  // Pattern: "Workflow node completed" (logged by workflow.ts)
  const completedMatch = msg.match(/Workflow node completed.*nodeName[:\s"]+(\w[-\w]*)/);
  if (completedMatch) {
    return {
      time: record.time || new Date().toISOString(),
      source: record.source,
      type: "node_end",
      name: normalizeNodeName(completedMatch[1]),
      status: "success",
    };
  }

  // Pattern: "Workflow started" (logged by workflow.ts)
  if (msg.includes("Workflow started")) {
    return {
      time: record.time || new Date().toISOString(),
      source: record.source,
      type: "node_start",
      name: "workflow",
    };
  }

  // Pattern: node-specific log indicating start (e.g. "Router LLM input", "Planner LLM input")
  const nodeStartMatch = msg.match(/^\[(\w[-\w]*)\]\s.*(?:LLM input|starting|started)/i);
  if (nodeStartMatch) {
    const name = normalizeNodeName(nodeStartMatch[1]);
    if (KNOWN_NODES.has(name)) {
      return {
        time: record.time || new Date().toISOString(),
        source: record.source,
        type: "node_start",
        name,
      };
    }
  }

  // Pattern: node failure
  const failMatch = msg.match(/^\[(\w[-\w]*)\].*(?:failed|error|exception)/i);
  if (failMatch) {
    const name = normalizeNodeName(failMatch[1]);
    if (KNOWN_NODES.has(name)) {
      return {
        time: record.time || new Date().toISOString(),
        source: record.source,
        type: "node_end",
        name,
        status: "error",
        detail: msg,
      };
    }
  }

  return null;
}

function buildLlmEvent(record: ParsedLogRecord): TimelineEvent {
  const status = record.status === "error" ? ("error" as const) : ("success" as const);

  return {
    time: record.time || new Date().toISOString(),
    source: "llm",
    type: "llm_call",
    name: record.agentName || "llm",
    durationMs: record.durationMs,
    status,
    detail: record.message,
  };
}

function normalizeNodeName(name: string): string {
  // Remove common suffixes for cleaner flowchart display.
  return name.replace(/-node$/, "").toLowerCase();
}

function humanizeNodeName(name: string): string {
  const labels: Record<string, string> = {
    workflow: "Workflow",
    router: "Router",
    clarification: "Clarification",
    planner: "Planner",
    query: "Query",
    analysis: "Analysis",
    "analysis-agent": "Deep Analysis",
    "deep-analysis-response": "Deep Analysis Response",
    visualization: "Visualization",
    response: "Response",
    "multi-dim-summary": "Multi-Dim Summary",
  };

  return (
    labels[name] ||
    name
      .split(/[-_]/)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ")
  );
}

/**
 * Detect groups of nodes that ran in parallel (overlapping time ranges).
 *
 * Two nodes are parallel if node A started before node B ended and
 * node B started before node A ended.
 */
function detectParallelGroups(
  nodeMap: Map<string, { startTime?: string; endTime?: string }>
): string[][] {
  const entries = [...nodeMap.entries()].filter(([, data]) => data.startTime && data.endTime);

  if (entries.length < 2) return [];

  const groups: string[][] = [];
  const visited = new Set<string>();

  for (let i = 0; i < entries.length; i++) {
    if (visited.has(entries[i][0])) continue;

    const group: string[] = [entries[i][0]];
    const aStart = new Date(entries[i][1].startTime!).getTime();
    const aEnd = new Date(entries[i][1].endTime!).getTime();

    for (let j = i + 1; j < entries.length; j++) {
      if (visited.has(entries[j][0])) continue;

      const bStart = new Date(entries[j][1].startTime!).getTime();
      const bEnd = new Date(entries[j][1].endTime!).getTime();

      if (aStart < bEnd && bStart < aEnd) {
        group.push(entries[j][0]);
      }
    }

    if (group.length > 1) {
      for (const name of group) visited.add(name);
      groups.push(group);
    }
  }

  return groups;
}

/**
 * Correlate an unattributed error event to the most likely node
 * based on temporal proximity (error falls within the node's time range).
 */
function correlateErrorToNode(
  errorEvent: TimelineEvent,
  nodes: FlowchartNode[]
): FlowchartNode | null {
  const errorTime = new Date(errorEvent.time).getTime();
  if (isNaN(errorTime)) return null;

  let bestMatch: FlowchartNode | null = null;
  let bestDistance = Infinity;

  for (const node of nodes) {
    if (!node.startTime) continue;

    const nodeStart = new Date(node.startTime).getTime();
    const nodeEnd = node.endTime
      ? new Date(node.endTime).getTime()
      : nodeStart + (node.durationMs || 60000);

    // Error falls within the node's time range
    if (errorTime >= nodeStart && errorTime <= nodeEnd) {
      const distance = errorTime - nodeStart;
      if (distance < bestDistance) {
        bestDistance = distance;
        bestMatch = node;
      }
    }
  }

  return bestMatch;
}
