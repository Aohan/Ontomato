/**
 * The caller of the current diagnosis response: its domain and the credential it came in with
 * (a login token, an API key, or neither in the open-source edition). Each response builds its
 * session and tools with this identity; it is not persisted.
 */
export interface DiagnosisCallerIdentity {
  domainId: string;
  token?: string;
  apiKey?: string;
}
