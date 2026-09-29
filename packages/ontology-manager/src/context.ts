import { inject, onUnmounted, provide, type InjectionKey } from "vue";
import {
  createManagerClient,
  type ManagerAuthFailureStatus,
  type ManagerClient,
  type ManagerCredential,
  type ManagerDataFallbacks,
} from "./api";
import { ontologyText, sharedText, type MessageKey, type SharedKey, type TextParams } from "./i18n";

export type ManagerTheme = "light" | "dark";

/**
 * 宿主静态装配的展示原值：两个产品的 Manager 各自原有的显示与交互差异。组件单份、不含版本标记，
 * 由应用 profile 一次给定，不随运行切换。
 */
export interface ManagerPresentation {
  /**
   * 组件根元素上按 theme 整组绑定的自定义属性：两版取值不同的主题变量，以及组件专用属性
   * --manager-relation-icon-color / --manager-relation-icon-background（图谱关系图标）、
   * --manager-model-catalog-min-height（模型目录）、--manager-modeling-panel-header-background（建模右栏表头）、
   * --manager-filter-drawer-radius（数据浏览筛选抽屉）。
   */
  readonly themeProperties: Readonly<Record<ManagerTheme, Readonly<Record<string, string>>>>;
  /** 本体图谱与可视化建模共用的节点色板，按类名哈希取色。 */
  readonly nodePalette: readonly string[];
  /** 本体图谱边样式中的标签片段，原样展开到边样式。 */
  readonly edgeLabel: Readonly<{ labelPlacement?: "center"; labelAutoRotate?: boolean }>;
  /** 本体图谱适配画布后的缩放上限；null 表示不设上限。 */
  readonly maxFitZoom: number | null;
  /** 数据浏览页头说明；参数为当前对象类型的显示名，未选择对象类型时没有。 */
  readonly dataBrowserDescription: (objectLabel: string | undefined) => string;
  /** 组件容器不超过 700px 时对话框改为窄屏布局。 */
  readonly compactDialogs: boolean;
  /** 是否显示工作区顶部品牌栏；嵌入宿主时置 false 隐藏（缺省显示）。 */
  readonly showWorkspaceHeader?: boolean;
}

/** 宿主传入的全部上下文；组件不读取宿主存储、document 主题类或全局路由。 */
export interface ManagerHostContext {
  apiBase: string;
  credential: ManagerCredential | null;
  locale: string;
  theme: ManagerTheme;
  /** 当前视图路径，例如 `/objects/x`、`/visual-modeling?focus=object&id=x`。 */
  view: string;
  /** 宿主静态装配的数据默认值，见 ManagerDataFallbacks。 */
  dataFallbacks: ManagerDataFallbacks;
  /** 宿主静态装配的展示原值，见 ManagerPresentation。 */
  presentation: ManagerPresentation;
}

const contextKey: InjectionKey<Readonly<ManagerHostContext>> = Symbol("ontology-manager-context");
const clientKey: InjectionKey<ManagerClient> = Symbol("ontology-manager-client");

/**
 * 由 Manager 工作区在 setup 中调用一次；context 是根组件的响应式 props。
 * 客户端的生命期就是该工作区：卸载后不再发请求。
 */
export function provideManagerContext(
  context: Readonly<ManagerHostContext>,
  onAuthFailure: (status: ManagerAuthFailureStatus) => void
) {
  const client = createManagerClient(context, onAuthFailure);
  provide(contextKey, context);
  provide(clientKey, client);
  onUnmounted(client.dispose);
  return client;
}

function injectFromHost<T>(key: InjectionKey<T>): T {
  const value = inject(key);
  if (!value) throw new Error("Ontology Manager 组件必须挂载在 provideManagerContext 的根组件内");
  return value;
}

export function useManagerContext() {
  return injectFromHost(contextKey);
}

export function useManagerClient() {
  return injectFromHost(clientKey);
}

/** 组件词条读取宿主当前 locale；Manager 自有词条与工作台共用词条的回退规则不同，分开取用。 */
export function useOntologyText() {
  const context = useManagerContext();
  const ot = (key: MessageKey, params?: TextParams) => ontologyText(context.locale, key, params);
  return { ot };
}

export function useSharedText() {
  const context = useManagerContext();
  const t = (key: SharedKey, params?: TextParams) => sharedText(context.locale, key, params);
  return { t };
}
