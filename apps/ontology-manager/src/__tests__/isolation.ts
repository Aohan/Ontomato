import { afterEach, vi } from "vitest";
import type { App } from "vue";

type Listener = Parameters<typeof window.removeEventListener>[1];
const SHELL_EVENTS = new Set(["message", "storage", "hashchange"]);

/**
 * 同一文件的用例共用一个 window；生产页面只启动一次外壳，没有停止接口。
 * 返回的清理函数撤销此后外壳注册的 window 监听与 MutationObserver，并卸载挂在 #app 上的实例；
 * 每个用例结束时自动执行，用例内重新启动外壳前也应先调用。
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
    // Vue 挂载时把应用实例记在容器的 __vue_app__ 上。
    (document.querySelector("#app") as (Element & { __vue_app__?: App }) | null)?.__vue_app__?.unmount();
  };
  afterEach(cleanup);
  return cleanup;
}
