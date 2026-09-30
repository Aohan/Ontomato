import { createLogger } from "../../../logging/logger";
import { tApp } from "../../../i18n";


const logger = createLogger("task-event-bus");

type EventCallback = (event: any) => void;
type StoredTaskEvent = { seq: number; event: any; timestamp: number };

const EVENT_RETENTION_MS = 30 * 60 * 1000;

function isTerminalTaskEvent(event: any): boolean {
  return (
    event?.type === "task_completed" ||
    event?.type === "task_cancelled" ||
    event?.type === "task_failed"
  );
}

export class TaskEventBus {
  private subscribers: Map<string, Set<EventCallback>> = new Map();
  private events: Map<string, StoredTaskEvent[]> = new Map();
  private cleanupTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

  subscribe(
    taskId: string,
    callback: EventCallback,
    options: { since?: number; requestSeq?: number } = {}
  ): () => void {
    const matchesTurn = (event: any) =>
      options.requestSeq === undefined || event.requestSeq === options.requestSeq;
    const subscriber: EventCallback = (event) => {
      if (matchesTurn(event)) callback(event);
    };
    if (!this.subscribers.has(taskId)) {
      this.subscribers.set(taskId, new Set());
    }
    this.subscribers.get(taskId)!.add(subscriber);

    const cleanupTimer = this.cleanupTimers.get(taskId);
    if (cleanupTimer) {
      clearTimeout(cleanupTimer);
      this.cleanupTimers.delete(taskId);
    }

    const since = options.since || 0;
    const storedEvents = this.events.get(taskId) || [];
    let replayedTerminal = false;
    for (const stored of storedEvents) {
      if (stored.seq <= since || !matchesTurn(stored.event)) continue;
      try {
        callback({ ...stored.event, _seq: stored.seq });
        if (isTerminalTaskEvent(stored.event)) {
          replayedTerminal = true;
          break;
        }
      } catch (error) {
        logger.error(tApp("analysis.task.task-event-bus.410", { taskId: taskId }), error);
      }
    }

    if (replayedTerminal) {
      this.subscribers.get(taskId)?.delete(subscriber);
      if (this.subscribers.get(taskId)?.size === 0) {
        this.subscribers.delete(taskId);
      }
      return () => {};
    }

    return () => {
      this.subscribers.get(taskId)?.delete(subscriber);
      if (this.subscribers.get(taskId)?.size === 0) {
        this.subscribers.delete(taskId);
      }
    };
  }

  emit(taskId: string, event: any): void {
    const existing = this.events.get(taskId) || [];
    const stored = { seq: existing.length + 1, event, timestamp: Date.now() };
    this.events.set(taskId, [...existing, stored]);

    const subs = this.subscribers.get(taskId);
    if (!subs || subs.size === 0) return;

    for (const callback of [...subs]) {
      try {
        callback({ ...event, _seq: stored.seq });
      } catch (error) {
        logger.error(tApp("analysis.task.task-event-bus.411", { taskId: taskId }), error);
      }
    }
  }

  beginRun(taskId: string): void {
    const cleanupTimer = this.cleanupTimers.get(taskId);
    if (cleanupTimer) {
      clearTimeout(cleanupTimer);
      this.cleanupTimers.delete(taskId);
    }
    this.events.delete(taskId);
  }

  clearTask(taskId: string): void {
    this.subscribers.delete(taskId);
    const existingTimer = this.cleanupTimers.get(taskId);
    if (existingTimer) clearTimeout(existingTimer);
    const timer = setTimeout(() => {
      this.events.delete(taskId);
      this.cleanupTimers.delete(taskId);
    }, EVENT_RETENTION_MS);
    timer.unref?.();
    this.cleanupTimers.set(taskId, timer);
  }
}

export const taskEventBus = new TaskEventBus();
