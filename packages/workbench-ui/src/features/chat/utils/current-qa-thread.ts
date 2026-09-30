import { workbenchContent } from "../../../content";

export function currentQaThreadStorageKey(ownerId: string, domainId: string): string {
  return `${workbenchContent().currentQaThreadStoragePrefix}:${encodeURIComponent(domainId)}:${encodeURIComponent(ownerId)}`;
}

export function rememberCurrentQaThread(ownerId: string, domainId: string, threadId: string): void {
  if (!threadId) return;
  sessionStorage.setItem(currentQaThreadStorageKey(ownerId, domainId), threadId);
}

export function restoreCurrentQaThread(ownerId: string, domainId: string): string | null {
  return sessionStorage.getItem(currentQaThreadStorageKey(ownerId, domainId))?.trim() || null;
}

export function forgetCurrentQaThread(ownerId: string, domainId: string): void {
  sessionStorage.removeItem(currentQaThreadStorageKey(ownerId, domainId));
}
