import { ref, reactive } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { useI18n } from "vue-i18n";

export interface CrudAdminOptions<T extends Record<string, any>> {
  list: () => Promise<any>;
  add: (payload: Record<string, any>) => Promise<any>;
  edit: (payload: Record<string, any>) => Promise<any>;
  remove: (id: unknown) => Promise<any>;
  idField: keyof T;
  nameField: keyof T;
  createEmpty: () => T;
  copyEntity: (source: T, target: T) => void;
  buildPayload: (entity: T) => Record<string, any>;
  normalizeResponse: (res: any) => T[];
  validateRequired?: (entity: T) => string | null;
  deleteConfirmKey?: string;
  batchDeleteConfirmKey?: string;
  defaultViewMode?: "table" | "card";
  viewModeStorageKey?: string;
  /** Original count text at the end of the partial batch-delete failure message (each edition's original bytes). */
  batchDeleteFailureSuffix: (failed: number, total: number) => string;
}

export function useCrudAdmin<T extends Record<string, any>>(options: CrudAdminOptions<T>) {
  const { t } = useI18n();

  const loading = ref(false);
  const list = ref<T[]>([]);
  const savedViewMode = options.viewModeStorageKey
    ? localStorage.getItem(options.viewModeStorageKey)
    : null;
  const viewMode = ref<"table" | "card">(
    savedViewMode === "table" || savedViewMode === "card"
      ? savedViewMode
      : options.defaultViewMode || "table"
  );
  const multipleSelection = ref<T[]>([]);

  const dialogVisible = ref(false);
  const editingEntity = reactive(options.createEmpty()) as T;

  async function load() {
    loading.value = true;
    try {
      const res = await options.list();
      list.value = options.normalizeResponse(res);
    } catch (e: any) {
      ElMessage.error(e.message || t("admin.loadFailed"));
    } finally {
      loading.value = false;
    }
  }

  function openCreate() {
    const empty = options.createEmpty();
    for (const key of Object.keys(empty) as (keyof T)[]) {
      (editingEntity as any)[key] = (empty as any)[key];
    }
    dialogVisible.value = true;
  }

  function openEdit(row: T) {
    options.copyEntity(row, editingEntity);
    dialogVisible.value = true;
  }

  function handleSelectionChange(selection: T[]) {
    multipleSelection.value = selection;
  }

  function setViewMode(mode: "table" | "card") {
    viewMode.value = mode;
    if (options.viewModeStorageKey) {
      localStorage.setItem(options.viewModeStorageKey, mode);
    }
  }

  async function handleSave() {
    const requiredError = options.validateRequired?.(editingEntity);
    if (requiredError) {
      ElMessage.warning(requiredError);
      return;
    }
    try {
      const id = editingEntity[options.idField] as string | undefined;
      const payload = options.buildPayload(editingEntity as Readonly<T>);
      const res = id ? await options.edit(payload) : await options.add(payload);
      if (res.success) {
        ElMessage.success(t("admin.saveSuccess"));
        dialogVisible.value = false;
        await load();
      } else {
        ElMessage.error(res.message || t("admin.saveFailed"));
      }
    } catch (e: any) {
      ElMessage.error(e.message || t("admin.saveFailed"));
    }
  }

  async function handleDelete(row: T) {
    try {
      const name = String(row[options.nameField] || "");
      await ElMessageBox.confirm(
        t(options.deleteConfirmKey || "admin.deleteConfirm", { name }),
        t("common.tip"),
        { type: "warning" }
      );
      await options.remove((row as any)[options.idField]);
      ElMessage.success(t("admin.deletedSuccess"));
      await load();
    } catch (e: any) {
      if (e !== "cancel") ElMessage.error(e.message || t("admin.deleteFailed"));
    }
  }

  async function handleBatchDelete() {
    if (!multipleSelection.value.length) return;
    try {
      await ElMessageBox.confirm(
        t(options.batchDeleteConfirmKey || "admin.batchDeleteConfirm", {
          n: multipleSelection.value.length,
        }),
        t("common.tip"),
        { type: "warning" }
      );
      const results = await Promise.allSettled(
        multipleSelection.value.map((item) => options.remove((item as any)[options.idField]))
      );
      const failed = results.filter((r) => r.status === "rejected").length;
      if (failed > 0) {
        ElMessage.warning(
          t("hotData.batchDeleteFailed") + options.batchDeleteFailureSuffix(failed, results.length)
        );
      } else {
        ElMessage.success(t("hotData.batchDeleteSuccess"));
      }
      await load();
    } catch (e: any) {
      if (e !== "cancel") ElMessage.error(e.message || t("admin.deleteFailed"));
    }
  }

  return {
    loading,
    list,
    viewMode,
    setViewMode,
    multipleSelection,
    dialogVisible,
    editingEntity,
    load,
    openCreate,
    openEdit,
    handleSelectionChange,
    handleSave,
    handleDelete,
    handleBatchDelete,
  };
}
