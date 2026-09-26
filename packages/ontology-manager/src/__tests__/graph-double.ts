/**
 * 图谱库（G6/X6）内部的有限替身：happy-dom 没有布局与 SVG 测量，这里只记录事件处理器，
 * 其余调用都返回无副作用的惰性对象。页面、请求层与 fetch 之间的链路不经替身。
 */
type Handler = (event: unknown) => void;

function inert(): any {
  const target = () => proxy;
  const proxy: any = new Proxy(target, {
    get(_target, key) {
      if (key === "then") return undefined;
      if (key === Symbol.iterator) return function* () {};
      if (key === Symbol.toPrimitive) return () => 0;
      return proxy;
    },
    apply: () => proxy,
  });
  return proxy;
}

export const graphHandlers: Record<string, Handler> = {};

/** 页面交给图谱库的输入：构造选项、X6 addNode 参数、G6 适配时的缩放读写（getZoom 返回 zoom）。 */
export const graphRecord = {
  options: [] as any[],
  addedNodes: [] as any[],
  zoom: 1,
  zoomTo: [] as unknown[][],
};

export class GraphDouble {
  constructor(options: unknown) {
    graphRecord.options.push(options);
    const base = inert();
    return new Proxy(
      {},
      {
        get(_target, key) {
          if (key === "on") {
            return (name: string, handler: Handler) => {
              graphHandlers[name] = handler;
            };
          }
          if (key === "addNode") {
            return (node: unknown) => {
              graphRecord.addedNodes.push(node);
              return base;
            };
          }
          if (key === "getZoom") return () => graphRecord.zoom;
          if (key === "zoomTo") {
            return (...args: unknown[]) => {
              graphRecord.zoomTo.push(args);
              return base;
            };
          }
          return base[key as keyof typeof base];
        },
      }
    );
  }
}
