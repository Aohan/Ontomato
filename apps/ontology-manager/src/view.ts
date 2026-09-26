import { ref } from "vue";

function normalizeInitialRoute(value: string) {
  const trimmed = value.trim().replace(/^#/, "");
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

// 主系统旧可视化建模入口带来的定位参数，原样组成 Manager 视图查询串。
function visualModelingQuery(params: URLSearchParams) {
  const query = new URLSearchParams();
  for (const key of ["focus", "id", "back"]) {
    const value = params.get(key);
    if (value !== null) query.set(key, value);
  }
  const text = query.toString();
  return text ? `?${text}` : "";
}

// 非根 hash 优先（刷新与深链），其次主系统传入的 view，再次部署配置的初始路由。
function initialView(initialRoute: string) {
  const hashPath = window.location.hash.slice(1);
  if (hashPath && hashPath !== "/") return hashPath;
  const params = new URLSearchParams(window.location.search);
  const view = params.get("view");
  if (view === "data-browser") return "/data";
  if (view === "assets") return "/assets/metrics";
  if (view === "visual-modeling") return `/visual-modeling${visualModelingQuery(params)}`;
  return initialRoute ? normalizeInitialRoute(initialRoute) : "/playground";
}

/** 组件视图与地址栏 hash 同步：组件导航以替换方式写回（不增加历史），手动改 hash 时跟随。 */
export function syncView(initialRoute: string) {
  const view = ref("");
  const replaceView = (value: string) => {
    view.value = value;
    window.history.replaceState(window.history.state, "", `#${value}`);
  };
  replaceView(initialView(initialRoute));
  window.addEventListener("hashchange", () => (view.value = window.location.hash.slice(1)));
  return { view, replaceView };
}
