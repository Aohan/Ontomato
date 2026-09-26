import { toRaw } from "vue";

/**
 * 只对固定形状的外层解一层代理：读的是代理自身的保留位，
 * 不触碰用户数据。返回后 custom 等不透明字段必须原样引用，
 * 不再对它们使用 Vue 的代理识别或解包函数。
 */
export function plainOuter<T extends object>(value: T): T {
  return { ...(toRaw(value) as T) };
}
