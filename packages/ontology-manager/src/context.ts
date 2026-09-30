import { inject, onUnmounted, provide, type InjectionKey } from "vue";
import {
  createManagerClient,
  type ManagerAuthFailureStatus,
  type ManagerClient,
  type ManagerCredential,
  type ManagerDataFallbacks,
} from "./api";
import {
  ontologyText,
  sharedText,
  type ManagerMessages,
  type MessageKey,
  type SharedKey,
  type TextParams,
} from "./i18n";

export type ManagerTheme = "light" | "dark";

/**
 * Presentation values supplied statically by the host: each product's own display and interaction differences for the
 * Manager. There is a single component with no edition flags; the app profile supplies these once and they do not change at runtime.
 */
export interface ManagerPresentation {
  /**
   * Custom properties bound as a group per theme on the component root: theme variables whose values differ per product,
   * plus the component-specific --manager-relation-icon-color / --manager-relation-icon-background (graph relation icon),
   * --manager-model-catalog-min-height (model catalog), --manager-modeling-panel-header-background (modeling right-panel
   * header) and --manager-filter-drawer-radius (data browser filter drawer).
   */
  readonly themeProperties: Readonly<Record<ManagerTheme, Readonly<Record<string, string>>>>;
  /** Node palette shared by the ontology graph and visual modeling; colours are picked by class-name hash. */
  readonly nodePalette: readonly string[];
  /** Label fragment of the ontology graph edge style, spread into the edge style as-is. */
  readonly edgeLabel: Readonly<{ labelPlacement?: "center"; labelAutoRotate?: boolean }>;
  /** Zoom limit after the ontology graph fits the canvas; null means no limit. */
  readonly maxFitZoom: number | null;
  /** Data browser header description; the argument is the current object type's display name, absent when none is selected. */
  readonly dataBrowserDescription: (objectLabel: string | undefined) => string;
  /** Dialogs switch to the narrow layout when the component container is at most 700px wide. */
  readonly compactDialogs: boolean;
}

/** This edition's stored values of the three business knowledge tags: submitted and stored as-is; option labels come from Manager messages. */
export interface ManagerKnowledgeTagValues {
  readonly general: string;
  readonly business: string;
  readonly tech: string;
}

/** Everything the host passes in; the component does not read host storage, document theme classes or global routing. */
export interface ManagerHostContext {
  apiBase: string;
  credential: ManagerCredential | null;
  locale: string;
  /** Messages for the current locale; the host changes them together with locale. */
  messages: ManagerMessages;
  theme: ManagerTheme;
  /** Current view path, e.g. `/objects/x` or `/visual-modeling?focus=object&id=x`. */
  view: string;
  /** Data defaults supplied statically by the host; see ManagerDataFallbacks. */
  dataFallbacks: ManagerDataFallbacks;
  /** Presentation values supplied statically by the host; see ManagerPresentation. */
  presentation: ManagerPresentation;
  /** Business knowledge tag values supplied statically by the host; see ManagerKnowledgeTagValues. */
  knowledgeTagValues: ManagerKnowledgeTagValues;
  /** Embedded in a host page: the host already has the Ontology Manager tab and back navigation, so the brand header is hidden. */
  embedded: boolean;
  /** The host's knowledge governance page URL (only when the current user has governance permission); the knowledge page shows an entry for it; null when absent. */
  knowledgeGovernanceUrl: string | null;
}

const contextKey: InjectionKey<Readonly<ManagerHostContext>> = Symbol("ontology-manager-context");
const clientKey: InjectionKey<ManagerClient> = Symbol("ontology-manager-client");

/**
 * Called once by the Manager workspace in setup; context is the root component's reactive props.
 * The client lives as long as that workspace: no requests are sent after it unmounts.
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
  if (!value) throw new Error("Ontology Manager components must be mounted inside the root component that calls provideManagerContext");
  return value;
}

export function useManagerContext() {
  return injectFromHost(contextKey);
}

export function useManagerClient() {
  return injectFromHost(clientKey);
}

/** Component text reads the messages the host supplied for its current locale; Manager-owned and workbench-shared messages are looked up separately. */
export function useOntologyText() {
  const context = useManagerContext();
  const ot = (key: MessageKey, params?: TextParams) => ontologyText(context.messages, key, params);
  return { ot };
}

export function useSharedText() {
  const context = useManagerContext();
  const t = (key: SharedKey, params?: TextParams) => sharedText(context.messages, key, params);
  return { t };
}
