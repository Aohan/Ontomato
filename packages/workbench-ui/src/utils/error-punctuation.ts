/** Punctuation joining request error details: the values differ per edition (open source uses ASCII ":" and ";"), are supplied statically by the app and do not change with the UI locale. */
export interface ErrorPunctuation {
  /** Between the main message and field details. */
  detailSeparator: string;
  /** Between multiple field details. */
  listSeparator: string;
}

let punctuation: ErrorPunctuation | null = null;

export function installErrorPunctuation(next: ErrorPunctuation): void {
  punctuation = next;
}

export function errorPunctuation(): ErrorPunctuation {
  if (!punctuation) throw new Error("Workbench error punctuation is not installed");
  return punctuation;
}
