/// <reference types="vite/client" />

declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<object, object, unknown>;
  export default component;
}

/** 后端 `/config.js` 注入的运行配置；LANGUAGE_SWITCH_ENABLED 为既有的显式覆盖项，当前后端不注入。 */
interface Window {
  __APP_CONFIG__?: {
    API_BASE?: string;
    DEFAULT_LOCALE?: string;
    LANGUAGE_SWITCH_ENABLED?: boolean;
    ONTOLOGY_MANAGER_URL?: string;
  };
}
