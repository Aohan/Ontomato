import { inject } from "vue";
import { adminAccessKey } from "../navigation";

/** Pages under the admin layout read the app's access check; usable only inside AdminLayout. */
export function useAdminAccess() {
  const access = inject(adminAccessKey);
  if (!access) throw new Error("useAdminAccess must be used inside AdminLayout");
  return access;
}
