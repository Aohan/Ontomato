import type { ManagerShellProfile } from "./shell";
import { ossPresentation } from "./presentation";

export const ossProfile: ManagerShellProfile = {
  noCredential: { type: "anonymous" },
  themeMessage: "ontomato-theme",
  locale: "en",
  localeSync: null,
  dataFallbacks: {
    noBusinessDescription: "No business description provided",
    unnamedAsset: "Unnamed asset",
  },
  presentation: ossPresentation,
};
