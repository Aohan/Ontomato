let created = 0;

/**
 * 每个 Manager 实例的 Element Plus id 前缀。EP 默认前缀是 0–9999 的随机数，
 * 实例前缀从 10000 起，避免与宿主自己的 Element 组件共用 popper 容器。
 */
export function nextElementIdPrefix() {
  return 10000 + created++;
}
