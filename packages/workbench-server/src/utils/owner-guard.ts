export function requireOwner(resourceOwnerId: string, requestUserId: string): boolean {
  return resourceOwnerId === requestUserId;
}
