import { afterEach, vi } from "vitest";
import type { App } from "vue";

type Listener = Parameters<typeof window.removeEventListener>[1];
const SHELL_EVENTS = new Set(["message", "storage", "hashchange"]);

/**
 * Tests in one file share a window; the production page starts the shell only once and has no stop API.
 * The returned cleanup removes the window listeners and MutationObservers the shell registers afterwards and unmounts
 * the instance on #app; it runs automatically after each test and should also be called before restarting the shell within a test.
 */
export function isolateShellPerTest() {
  const listeners: [string, Listener][] = [];
  const observers: MutationObserver[] = [];
  const addEventListener = window.addEventListener.bind(window);
  vi.spyOn(window, "addEventListener").mockImplementation(
    (type: string, listener: Listener, options?: Parameters<typeof window.addEventListener>[2]) => {
      if (SHELL_EVENTS.has(type)) listeners.push([type, listener]);
      addEventListener(type, listener, options);
    }
  );
  const observe = MutationObserver.prototype.observe;
  vi.spyOn(MutationObserver.prototype, "observe").mockImplementation(function (
    this: MutationObserver,
    target: Node,
    options?: Parameters<MutationObserver["observe"]>[1]
  ) {
    observers.push(this);
    observe.call(this, target, options);
  });

  const cleanup = () => {
    listeners.splice(0).forEach(([type, listener]) => window.removeEventListener(type, listener));
    observers.splice(0).forEach((observer) => observer.disconnect());
    // When mounting, Vue records the app instance on the container's __vue_app__.
    (document.querySelector("#app") as (Element & { __vue_app__?: App }) | null)?.__vue_app__?.unmount();
  };
  afterEach(cleanup);
  return cleanup;
}
