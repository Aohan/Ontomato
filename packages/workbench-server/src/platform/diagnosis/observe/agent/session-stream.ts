import type {
  DiagnosisResponseTerminalStatus,
  DiagnosisStreamEvent,
} from "@ontomato/contracts/diagnosis";

export interface BufferedDiagnosisEvent {
  seq: number;
  event: DiagnosisStreamEvent;
  terminal: boolean;
}

export type DiagnosisEventSubscriber = (event: BufferedDiagnosisEvent) => boolean | void;

/**
 * The transient event tail for a session's current response.
 *
 * It intentionally has no independent business id or persistence. The owning
 * diagnosis session retains one instance for replay until the next response.
 */
export class SessionResponseStream {
  readonly controller = new AbortController();
  private readonly events: BufferedDiagnosisEvent[] = [];
  private readonly subscribers = new Set<DiagnosisEventSubscriber>();
  private terminalStatus?: DiagnosisResponseTerminalStatus;

  get status(): "running" | DiagnosisResponseTerminalStatus {
    return this.terminalStatus ?? "running";
  }

  append(event: DiagnosisStreamEvent): BufferedDiagnosisEvent {
    if (this.terminalStatus) {
      throw new Error("Cannot append to a finished diagnosis response");
    }

    const terminal = event.type === "response_end" || event.type === "error";
    const buffered: BufferedDiagnosisEvent = {
      seq: this.events.length + 1,
      event,
      terminal,
    };
    this.events.push(buffered);

    for (const subscriber of [...this.subscribers]) {
      if (subscriber(buffered) === false) {
        this.subscribers.delete(subscriber);
      }
    }

    if (terminal) {
      this.terminalStatus = event.type === "error" ? "failed" : event.status;
      this.subscribers.clear();
    }

    return buffered;
  }

  subscribe(afterSeq: number, subscriber: DiagnosisEventSubscriber): () => void {
    for (const event of this.events) {
      if (event.seq <= afterSeq) continue;
      if (subscriber(event) === false || event.terminal) return () => {};
    }

    if (this.terminalStatus) return () => {};
    this.subscribers.add(subscriber);
    return () => {
      this.subscribers.delete(subscriber);
    };
  }

  cancel(): boolean {
    if (this.terminalStatus || this.controller.signal.aborted) return false;
    this.controller.abort();
    return true;
  }
}
