/**
 * Manager 入口的应用静态差异：与本产品 Manager 外壳约定的消息名，以及原入口的固定文字（两版原值不同，未进词条）。
 * localeMessage 为 null 表示本产品的 Manager 不跟随主系统语言：既不发语言消息，也不在地址里带 locale（开源原样）。
 */
export interface OntologyManagerEntryConfig {
  themeMessage: string;
  localeMessage: string | null;
  frameTitle: string;
  missingUrlTitle: string;
  missingUrlDescription: string;
}

let entryConfig: OntologyManagerEntryConfig | null = null;

export function installOntologyManagerEntry(next: OntologyManagerEntryConfig): void {
  entryConfig = next;
}

export function ontologyManagerEntryConfig(): OntologyManagerEntryConfig {
  if (!entryConfig) throw new Error("Ontology manager entry is not installed");
  return entryConfig;
}
