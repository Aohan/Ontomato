<script setup lang="ts">
import { computed } from "vue";
import { Link2 } from "lucide-vue-next";
import { useI18n } from "vue-i18n";
import type { DataAdapterConnection, DataAdapterInfo, SystemSettings } from "../../types";
import type { BusinessConfigAdapterDisplay } from "../../business-config";

const { t } = useI18n();

const props = defineProps<{
  saving: boolean;
  disabled: boolean;
  adapters: DataAdapterInfo[];
  adapterDisplay: BusinessConfigAdapterDisplay;
}>();

const config = defineModel<SystemSettings>("config", { required: true });
const mode = defineModel<string>("mode", { required: true });

const emit = defineEmits<{
  save: [];
}>();

const selected = computed(() => props.adapters.find(({ type }) => type === mode.value));

function connection(type: string): DataAdapterConnection {
  config.value.dataAdapterConnections[type] ??= {};
  return config.value.dataAdapterConnections[type];
}
</script>

<template>
  <div class="admin-card config-card">
    <div class="card-header">
      <el-icon :size="20"><Link2 /></el-icon>
      <span>{{ t("admin.dataAdapterConfig") }}</span>
    </div>
    <div class="card-body">
      <el-form
        class="config-form"
        :disabled="disabled"
        :label-width="adapterDisplay.labelWidth"
        label-position="left"
        size="default"
      >
        <el-form-item :label="t('admin.adapterMode')">
          <el-radio-group v-model="mode">
            <el-radio v-for="adapter in adapters" :key="adapter.type" :value="adapter.type">{{
              adapter.label
            }}</el-radio>
          </el-radio-group>
        </el-form-item>

        <template v-if="selected">
          <el-row v-if="selected.fields.includes('url')" :gutter="24">
            <el-col :span="adapterDisplay.urlSpan">
              <el-form-item :label="t('admin.connectionUrl')">
                <el-input
                  v-model="connection(selected.type).url"
                  :placeholder="selected.examples.url"
                />
              </el-form-item>
            </el-col>
          </el-row>
          <el-row
            v-if="selected.fields.includes('user') || selected.fields.includes('password')"
            :gutter="24"
          >
            <el-col v-if="selected.fields.includes('user')" :span="adapterDisplay.credentialSpan">
              <el-form-item :label="t('common.username')">
                <el-input
                  v-model="connection(selected.type).user"
                  :placeholder="selected.examples.user"
                />
              </el-form-item>
            </el-col>
            <el-col
              v-if="selected.fields.includes('password')"
              :span="adapterDisplay.credentialSpan"
            >
              <el-form-item :label="t('common.password')">
                <el-input
                  v-model="connection(selected.type).password"
                  type="password"
                  placeholder="******"
                  show-password
                />
              </el-form-item>
            </el-col>
          </el-row>
        </template>

        <el-form-item class="form-actions">
          <el-button type="primary" :loading="saving" :disabled="disabled" @click="emit('save')">
            {{ t("common.saveAdapterConfig") }}
          </el-button>
        </el-form-item>
      </el-form>
    </div>
  </div>
</template>

<style scoped src="./business-config.css"></style>
