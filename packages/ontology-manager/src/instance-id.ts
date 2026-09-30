let created = 0;

/**
 * Element Plus id prefix for each Manager instance. EP's default prefix is a random number in 0–9999;
 * instance prefixes start at 10000 so they never share a popper container with the host's own Element components.
 */
export function nextElementIdPrefix() {
  return 10000 + created++;
}
