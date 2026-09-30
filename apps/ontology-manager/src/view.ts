import { ref } from "vue";

function normalizeInitialRoute(value: string) {
  const trimmed = value.trim().replace(/^#/, "");
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

// Location parameters from the main system's old visual modeling entry form the Manager view query as-is.
function visualModelingQuery(params: URLSearchParams) {
  const query = new URLSearchParams();
  for (const key of ["focus", "id", "back"]) {
    const value = params.get(key);
    if (value !== null) query.set(key, value);
  }
  const text = query.toString();
  return text ? `?${text}` : "";
}

// A non-root hash wins (reloads and deep links), then the view passed by the main system, then the deployment's initial route.
function initialView(initialRoute: string) {
  const hashPath = window.location.hash.slice(1);
  if (hashPath && hashPath !== "/") return hashPath;
  const params = new URLSearchParams(window.location.search);
  const view = params.get("view");
  if (view === "data-browser") return "/data";
  if (view === "assets") return "/assets/metrics";
  if (view === "knowledge") return "/knowledge";
  if (view === "visual-modeling") return `/visual-modeling${visualModelingQuery(params)}`;
  return initialRoute ? normalizeInitialRoute(initialRoute) : "/playground";
}

/** Keeps the component view and the address bar hash in sync: component navigation replaces the hash (no history entry) and manual hash changes are followed. */
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
