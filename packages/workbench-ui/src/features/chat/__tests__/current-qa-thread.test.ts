import { beforeEach, describe, expect, it } from "vitest";
import {
  forgetCurrentQaThread,
  rememberCurrentQaThread,
  restoreCurrentQaThread,
} from "../utils/current-qa-thread";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

describe("current QA thread storage", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, "sessionStorage", {
      configurable: true,
      value: new MemoryStorage(),
    });
  });

  it("isolates restored threads by owner and domain", () => {
    rememberCurrentQaThread("user-1", "domain-a", "thread-1");
    rememberCurrentQaThread("user-1", "domain-b", "thread-2");

    expect(restoreCurrentQaThread("user-1", "domain-a")).toBe("thread-1");
    expect(restoreCurrentQaThread("user-1", "domain-b")).toBe("thread-2");
    expect(restoreCurrentQaThread("user-2", "domain-a")).toBeNull();

    forgetCurrentQaThread("user-1", "domain-a");
    expect(restoreCurrentQaThread("user-1", "domain-a")).toBeNull();
    expect(restoreCurrentQaThread("user-1", "domain-b")).toBe("thread-2");
  });
});
