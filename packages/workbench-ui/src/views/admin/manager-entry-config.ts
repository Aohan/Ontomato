/**
 * Static app differences of the Manager entry: the message types agreed with this product's Manager shell, and the
 * original entry's fixed text (values differ per edition and are not messages). A null localeMessage means this product's
 * Manager does not follow the main system's locale: no locale message is sent and no locale is put in the URL (as in open source).
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
