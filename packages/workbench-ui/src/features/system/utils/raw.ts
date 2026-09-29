import { toRaw } from "vue";

/**
 * Unwraps one proxy layer of a fixed-shape outer object only: it reads the proxy's own reserved slot and never touches
 * user data. Afterwards opaque fields such as custom must be referenced as-is, without Vue's proxy detection or unwrap helpers.
 */
export function plainOuter<T extends object>(value: T): T {
  return { ...(toRaw(value) as T) };
}
