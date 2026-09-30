/**
 * App assembly input of the system config page (BusinessConfig): each app passes its edition values as props on the route record.
 * Business defaults, the UI locale and the Node product config are not derived from one another.
 */

/** Original layout of the data adapter card: form label width and a two-column grid for URL and credentials. */
export interface BusinessConfigAdapterDisplay {
  labelWidth: string;
  urlSpan: number;
  credentialSpan: number;
}

/** One backend language option: the stored value and its fixed display label (not derived from the UI locale). */
export interface BusinessConfigLanguageOption {
  value: string;
  label: string;
}

export interface BusinessConfigProps {
  /** Default business config language: shared by the initial value, the load default and the language dropdown placeholder. */
  defaultLanguage: string;
  /** Backend languages this edition's data engine ships resources for, in display order; the only selectable values. */
  languageOptions: readonly BusinessConfigLanguageOption[];
  adapterDisplay: BusinessConfigAdapterDisplay;
}
