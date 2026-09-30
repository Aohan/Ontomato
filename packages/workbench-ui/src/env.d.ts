/// <reference types="vite/client" />

declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<object, object, unknown>;
  export default component;
}

/** Runtime config injected by the backend `/config.js`; LANGUAGE_SWITCH_ENABLED is an existing explicit override that the current backend does not inject. */
interface Window {
  __APP_CONFIG__?: {
    API_BASE?: string;
    DEFAULT_LOCALE?: string;
    LANGUAGE_SWITCH_ENABLED?: boolean;
    ONTOLOGY_MANAGER_URL?: string;
  };
}
