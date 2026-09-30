import { runAgentLoop } from "./agent-loop";
import type { HarnessRun } from "./session-run";
import type { AgentState, AgentTool, AgentEventListener, ModelConfig } from "./types";

export class Agent {
  state: AgentState;
  private config: ModelConfig;
  private listeners = new Set<AgentEventListener>();
  private abortController?: AbortController;

  private session?: HarnessRun;

  constructor(
    config: ModelConfig,
    options?: { systemPrompt?: string; tools?: AgentTool[]; session?: HarnessRun }
  ) {
    this.config = config;
    this.session = options?.session;
    this.state = {
      systemPrompt: options?.systemPrompt ?? "",
      messages: options?.session?.context.messages ?? [],
      tools: options?.tools ?? [],
      isStreaming: false,
    };
  }

  subscribe(listener: AgentEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  setModelConfig(config: ModelConfig): void {
    this.config = config;
  }

  async prompt(message: string, signal?: AbortSignal): Promise<void> {
    this.abortController = new AbortController();
    const runSignal = signal
      ? AbortSignal.any([this.abortController.signal, signal])
      : this.abortController.signal;

    const emit: AgentEventListener = (event) => {
      for (const listener of this.listeners) {
        try {
          listener(event);
        } catch {
          // Listener errors must not break the loop
        }
      }
    };

    try {
      await runAgentLoop(message, this.state, this.config, emit, runSignal, {
        session: this.session,
      });
    } finally {
      this.abortController = undefined;
    }
  }

  abort(): void {
    this.abortController?.abort();
  }

  dispose(): void {
    this.abort();
    this.listeners.clear();
  }
}
