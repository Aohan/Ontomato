/**
 * A limited double for the graph libraries (G6/X6) internals: happy-dom has no layout or SVG measurement, so this only
 * records event handlers and returns inert, side-effect-free objects for every other call. The path between pages, the request layer and fetch is not doubled.
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

/** Inputs the page hands to the graph libraries: constructor options, X6 addNode arguments, and zoom reads/writes during G6 fitting (getZoom returns zoom). */
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
