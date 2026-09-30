import type { BusinessConfigProps } from "@ontomato/workbench-ui";

/** Original values of this edition's system config page (from BusinessConfig and its cards before extraction), passed through the /admin/system-config route props. */
export const businessConfig: BusinessConfigProps = {
  defaultLanguage: "en",
  adapterDisplay: {
    labelWidth: "150px",
    urlSpan: 24,
    credentialSpan: 12,
  },
  // The open-source data engine ships only lang/en.json.
  languageOptions: [{ value: "en", label: "English" }],
};
