import { inject } from "vue";
import { adminAccessKey } from "../navigation";

/** 管理布局下的页面读取应用的访问判定；只能在 AdminLayout 之内使用。 */
export function useAdminAccess() {
  const access = inject(adminAccessKey);
  if (!access) throw new Error("useAdminAccess 必须在 AdminLayout 之内使用");
  return access;
}
