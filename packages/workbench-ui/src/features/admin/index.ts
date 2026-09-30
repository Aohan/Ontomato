export { adminApi } from "./api";
export { default as AdminLayout } from "./components/layout/AdminLayout.vue";
export { default as AuditLogManager } from "./components/platform-operations/AuditLogManager.vue";
export type {
  AdminAccess,
  AdminAccount,
  AdminActionTab,
  AdminGroup,
  AdminLayoutConfig,
  AdminMenuItem,
} from "./navigation";
export { useAdminAccess } from "./composables/useAdminAccess";
