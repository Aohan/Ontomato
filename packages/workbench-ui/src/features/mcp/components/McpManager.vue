<script setup lang="ts">
import { computed, ref, reactive, onMounted } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { Plus, RefreshCw, Pencil, Trash2, Copy, Plug, ArrowUpRight } from "lucide-vue-next";
import { useI18n } from "vue-i18n";
import {
  listMcpServices,
  saveMcpService,
  deleteMcpService,
  listExternalMcpTools,
  listPublishedMcpServices,
  type McpServiceConfig,
  type McpTool,
  type PublishedMcpService,
} from "../api";
import { ApiRequestError } from "../../../utils/api";
import McpToolList from "./McpToolList.vue";
import { workbenchContent } from "../../../content";

const { t } = useI18n();
const { analysisMcpServerName, opsMcpServerName } = workbenchContent();
// Published services this page recognizes by server name: their cards show a localized title and a connection hint.
const recognizedPublished = new Map([
  [analysisMcpServerName, { title: "mcp.agentService", hint: "mcp.publishedAuthHint" }],
  [opsMcpServerName, { title: "mcp.opsAgentService", hint: "mcp.opsPublishedAuthHint" }],
]);
const activeTab = ref("external");
const services = ref<McpServiceConfig[]>([]);
const published = ref<PublishedMcpService[]>([]);
const loading = ref(false);
const loadFailed = ref(false);
const publishedLoading = ref(false);
const publishedFailed = ref(false);
const publishedLoaded = ref(false);
const tools = ref<Record<string, { loading: boolean; failed: boolean; items: McpTool[] }>>({});
const dialogVisible = ref(false);
const saving = ref(false);
const previousName = ref<string>();
const form = ref({ name: "", url: "", headers: [] as Array<{ name: string; value: string }> });
const publishedCards = computed(() =>
  published.value.map((service) => {
    const text = recognizedPublished.get(service.name);
    return {
      service,
      title: text ? t(text.title) : service.title || service.name,
      hint: text ? t(text.hint) : "",
    };
  })
);

async function loadServices() {
  loading.value = true;
  loadFailed.value = false;
  try {
    services.value = await listMcpServices();
    tools.value = {};
  } catch {
    loadFailed.value = true;
  } finally {
    loading.value = false;
  }
}
async function loadPublished() {
  publishedLoading.value = true;
  publishedFailed.value = false;
  try {
    published.value = await listPublishedMcpServices();
    publishedLoaded.value = true;
  } catch {
    publishedFailed.value = true;
  } finally {
    publishedLoading.value = false;
  }
}
function changeTab() {
  if (activeTab.value === "published" && !publishedLoaded.value && !publishedLoading.value) {
    void loadPublished();
  }
}
function openEditor(service?: McpServiceConfig) {
  previousName.value = service?.name;
  form.value = {
    name: service?.name || "",
    url: service?.url || "",
    headers: Object.entries(service?.headers || {}).map(([name, value]) => ({ name, value })),
  };
  dialogVisible.value = true;
}
async function save() {
  const name = form.value.name.trim();
  const url = form.value.url.trim();
  if (!name || !url) return ElMessage.warning(t("hotData.fillNameAndAddress"));
  try {
    if (!["http:", "https:"].includes(new URL(url).protocol)) throw new Error();
  } catch {
    return ElMessage.warning(t("hotData.addressFormatHint"));
  }
  const headers: Record<string, string> = {};
  const names = new Set<string>();
  for (const row of form.value.headers) {
    const key = row.name.trim();
    if (!key && !row.value) continue;
    if (!key || names.has(key.toLowerCase())) return ElMessage.warning(t("mcp.invalidHeaders"));
    names.add(key.toLowerCase());
    headers[key] = row.value;
  }
  try {
    new Headers(headers);
  } catch {
    return ElMessage.warning(t("mcp.invalidHeaders"));
  }
  saving.value = true;
  try {
    await saveMcpService({ name, url, headers }, previousName.value);
    dialogVisible.value = false;
    ElMessage.success(t("admin.saveSuccess"));
    await loadServices();
  } catch (error) {
    ElMessage.error(
      t(
        error instanceof ApiRequestError && error.code === "MCP_NAME_EXISTS"
          ? "mcp.nameExists"
          : "admin.saveFailed"
      )
    );
  } finally {
    saving.value = false;
  }
}
async function remove(service: McpServiceConfig) {
  try {
    await ElMessageBox.confirm(
      t("hotData.deleteMcpConfirm", { name: service.name }),
      t("common.tip"),
      { type: "warning" }
    );
    await deleteMcpService(service.name);
    ElMessage.success(t("admin.deletedSuccess"));
    await loadServices();
  } catch (error) {
    if (error !== "cancel" && error !== "close") ElMessage.error(t("admin.deleteFailed"));
  }
}
async function inspectTools(service: McpServiceConfig) {
  const state = reactive({ loading: true, failed: false, items: [] as McpTool[] });
  tools.value[service.name] = state;
  try {
    state.items = await listExternalMcpTools(service.name);
  } catch {
    state.failed = true;
  } finally {
    state.loading = false;
    // The list may have been refreshed or the service renamed while discovery was running.
    if (tools.value[service.name] === state) tools.value[service.name] = { ...state };
  }
}
async function copy(address: string) {
  try {
    await navigator.clipboard.writeText(address);
    ElMessage.success(t("hotData.addressCopied"));
  } catch {
    ElMessage.error(t("chat.copyFailed"));
  }
}
onMounted(loadServices);
</script>

<template>
  <div class="mcp-manager">
    <el-tabs v-model="activeTab" @tab-change="changeTab">
      <el-tab-pane name="external" :label="t('mcp.externalTab')">
        <div class="section-heading">
          <div>
            <h3>{{ t("mcp.externalTab") }}</h3>
            <p>{{ t("mcp.externalHint") }}</p>
          </div>
          <div class="actions">
            <el-button :icon="RefreshCw" :loading="loading" @click="loadServices">
              {{ t("common.refresh") }}
            </el-button>
            <el-button
              type="primary"
              :icon="Plus"
              :disabled="loading || loadFailed"
              @click="openEditor()"
            >
              {{ t("hotData.addService") }}
            </el-button>
          </div>
        </div>
        <div
          v-if="loading"
          v-loading="true"
          class="loading-panel"
          :aria-label="t('common.loading')"
        />
        <el-alert
          v-else-if="loadFailed"
          type="error"
          :closable="false"
          show-icon
          :title="t('mcp.loadFailed')"
        >
          <el-button text @click="loadServices">{{ t("common.retry") }}</el-button>
        </el-alert>
        <el-empty
          v-else-if="!services.length"
          :description="t('mcp.emptyServices')"
          :image-size="88"
        >
          <el-button type="primary" :icon="Plus" @click="openEditor()">
            {{ t("hotData.addService") }}
          </el-button>
        </el-empty>
        <div v-else class="service-list">
          <article v-for="service in services" :key="service.name" class="service-card">
            <div class="service-heading">
              <div class="service-title">
                <Plug :size="20" />
                <h4>{{ service.name }}</h4>
              </div>
              <div class="actions">
                <el-button :icon="Pencil" @click="openEditor(service)">
                  {{ t("common.edit") }}
                </el-button>
                <el-button :icon="Trash2" type="danger" plain @click="remove(service)">
                  {{ t("common.delete") }}
                </el-button>
              </div>
            </div>
            <div class="service-address">{{ service.url }}</div>
            <div class="service-footer">
              <span class="muted">
                {{ t("mcp.headersCount", { count: Object.keys(service.headers).length }) }}
              </span>
              <el-button
                text
                type="primary"
                :loading="tools[service.name]?.loading"
                @click="inspectTools(service)"
              >
                {{ t("mcp.viewTools") }}
              </el-button>
            </div>
            <template v-if="tools[service.name] && !tools[service.name].loading">
              <el-alert
                v-if="tools[service.name].failed"
                :title="t('mcp.discoveryFailed')"
                type="error"
                :closable="false"
                show-icon
              />
              <McpToolList v-else :tools="tools[service.name].items" />
            </template>
          </article>
        </div>
      </el-tab-pane>
      <el-tab-pane name="published" :label="t('mcp.publishedTab')">
        <div class="section-heading">
          <div>
            <h3>{{ t("mcp.publishedTab") }}</h3>
            <p>{{ t("mcp.publishedHint") }}</p>
          </div>
          <el-button :icon="RefreshCw" :loading="publishedLoading" @click="loadPublished">
            {{ t("common.refresh") }}
          </el-button>
        </div>
        <div
          v-if="publishedLoading"
          v-loading="true"
          class="loading-panel"
          :aria-label="t('common.loading')"
        />
        <el-alert
          v-else-if="publishedFailed"
          :title="t('mcp.loadFailed')"
          type="error"
          :closable="false"
          show-icon
        >
          <el-button text @click="loadPublished">{{ t("common.retry") }}</el-button>
        </el-alert>
        <div v-else class="service-list">
          <article
            v-for="{ service, title, hint } in publishedCards"
            :key="service.name"
            class="service-card"
          >
            <div class="service-title">
              <ArrowUpRight :size="20" />
              <h4>{{ title }}</h4>
            </div>
            <div class="address-row">
              <code class="service-address">
                {{ service.mcpUrl || t("hotData.notConfigured") }}
              </code>
              <el-button v-if="service.mcpUrl" :icon="Copy" @click="copy(service.mcpUrl)">
                {{ t("common.copy") }}
              </el-button>
            </div>
            <p v-if="hint" class="muted">{{ hint }}</p>
            <details class="published-tools">
              <summary>{{ t("mcp.availableTools") }} · {{ service.tools.length }}</summary>
              <McpToolList :tools="service.tools" />
            </details>
          </article>
        </div>
      </el-tab-pane>
    </el-tabs>
    <el-dialog
      v-model="dialogVisible"
      :title="previousName === undefined ? t('hotData.addService') : t('mcp.editService')"
      width="600px"
      class="mcp-editor"
      :close-on-click-modal="false"
    >
      <el-form label-position="top" @submit.prevent="save">
        <el-form-item :label="t('hotData.serviceName')" required>
          <el-input v-model="form.name" maxlength="100" :aria-label="t('hotData.serviceName')" />
        </el-form-item>
        <el-form-item :label="t('hotData.serviceAddress')" required>
          <el-input
            v-model="form.url"
            placeholder="https://example.com/mcp"
            :aria-label="t('hotData.serviceAddress')"
          />
          <p class="form-hint">{{ t("mcp.urlHint") }}</p>
        </el-form-item>
        <el-form-item :label="t('mcp.headers')">
          <div class="headers-editor">
            <p class="form-hint">{{ t("mcp.headersHint") }}</p>
            <div v-for="(header, index) in form.headers" :key="index" class="header-row">
              <el-input
                v-model="header.name"
                :placeholder="t('mcp.headerName')"
                :aria-label="t('mcp.headerName')"
              />
              <el-input
                v-model="header.value"
                type="password"
                show-password
                :placeholder="t('mcp.headerValue')"
                :aria-label="t('mcp.headerValue')"
              />
              <el-button
                :icon="Trash2"
                :aria-label="t('common.delete')"
                @click="form.headers.splice(index, 1)"
              />
            </div>
            <el-button
              text
              type="primary"
              :icon="Plus"
              @click="form.headers.push({ name: '', value: '' })"
            >
              {{ t("mcp.addHeader") }}
            </el-button>
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button :disabled="saving" @click="dialogVisible = false">
          {{ t("common.cancel") }}
        </el-button>
        <el-button type="primary" :loading="saving" @click="save">{{ t("common.save") }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.mcp-manager {
  color: var(--el-text-color-primary);
}
h3,
h4,
p {
  margin: 0;
}
h3 {
  font-size: 17px;
  font-weight: 600;
}
h4 {
  font-size: 16px;
  font-weight: 600;
  overflow-wrap: anywhere;
}
.section-heading p {
  margin-top: 8px;
  color: var(--el-text-color-regular);
  line-height: 1.6;
}
.section-heading,
.service-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.section-heading {
  margin: 8px 0 24px;
}
.actions,
.service-title,
.address-row {
  display: flex;
  align-items: center;
  gap: 12px;
}
.actions {
  flex-shrink: 0;
}
.actions .el-button + .el-button {
  margin-left: 0;
}
.service-title {
  min-width: 0;
}
.service-title svg {
  flex-shrink: 0;
  color: var(--el-color-primary);
}
.service-list {
  display: grid;
  gap: 16px;
}
.service-card {
  border: 1px solid var(--el-border-color-light);
  border-radius: 10px;
  padding: 20px;
  background: var(--el-bg-color);
  min-width: 0;
}
.service-address {
  display: block;
  margin-top: 12px;
  font-family: var(--el-font-family);
  color: var(--el-text-color-regular);
  overflow-wrap: anywhere;
  line-height: 1.6;
}
.address-row .service-address {
  flex: 1;
  min-width: 0;
}
.address-row .el-button {
  flex-shrink: 0;
}
.service-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 12px;
}
.muted,
.form-hint {
  color: var(--el-text-color-secondary);
  font-size: 13px;
  line-height: 1.6;
}
.service-card > .muted {
  margin-top: 12px;
}
.published-tools {
  margin-top: 16px;
  border-top: 1px solid var(--el-border-color-lighter);
  padding-top: 12px;
}
summary {
  cursor: pointer;
  line-height: 28px;
}
summary:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 3px;
}
.loading-panel {
  min-height: 200px;
}
.headers-editor {
  width: 100%;
}
.header-row {
  display: grid;
  grid-template-columns: 1fr 1.3fr auto;
  gap: 8px;
  margin: 10px 0;
}
.form-hint {
  margin: 6px 0;
}
:global(.mcp-editor) {
  max-width: calc(100vw - 32px);
}
@media (max-width: 768px) {
  .mcp-manager {
    padding: 16px;
  }
  .section-heading,
  .service-heading {
    align-items: flex-start;
    flex-direction: column;
  }
  .service-card {
    padding: 16px;
  }
  .address-row {
    flex-wrap: wrap;
  }
  .header-row {
    grid-template-columns: minmax(0, 1fr) auto;
  }
  .header-row > :first-child {
    grid-column: 1 / -1;
  }
}
</style>
