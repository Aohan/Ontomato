<script setup lang="ts">
import { Link2 } from "lucide-vue-next";
import { useI18n } from "vue-i18n";
import type {
  BusinessConfig,
  Db2AdapterConfig,
  DmAdapterConfig,
  DuckDBAdapterConfig,
  GaussDBAdapterConfig,
  MysqlAdapterConfig,
  OracleAdapterConfig,
  PgsqlAdapterConfig,
  SqlServerAdapterConfig,
} from "../../types";
import type { BusinessConfigAdapterDisplay, BusinessConfigExtraAdapter } from "../../business-config";

const { t } = useI18n();

defineProps<{
  saving: boolean;
  disabled: boolean;
  extraAdapter: Pick<BusinessConfigExtraAdapter, "mode" | "labelKey"> | null;
  adapterDisplay: BusinessConfigAdapterDisplay;
}>();

const config = defineModel<BusinessConfig>("config", { required: true });
const mode = defineModel<string>("mode", { required: true });

const emit = defineEmits<{
  save: [];
}>();

function ensureMysqlConfig(): MysqlAdapterConfig {
  if (!config.value.mysqlDataAdapterProperties) {
    config.value.mysqlDataAdapterProperties = { mysqlUrl: "", mysqlUser: "", mysqlPassword: "" };
  }
  return config.value.mysqlDataAdapterProperties;
}

function ensurePgsqlConfig(): PgsqlAdapterConfig {
  if (!config.value.pgsqlDataAdapterProperties) {
    config.value.pgsqlDataAdapterProperties = { pgsqlUrl: "", pgsqlUser: "", pgsqlPassword: "" };
  }
  return config.value.pgsqlDataAdapterProperties;
}

function ensureOracleConfig(): OracleAdapterConfig {
  if (!config.value.oracleDataAdapterProperties) {
    config.value.oracleDataAdapterProperties = {
      oracleUrl: "",
      oracleUser: "",
      oraclePassword: "",
    };
  }
  return config.value.oracleDataAdapterProperties;
}

function ensureSqlServerConfig(): SqlServerAdapterConfig {
  if (!config.value.sqlServerDataAdapterProperties) {
    config.value.sqlServerDataAdapterProperties = {
      sqlServerUrl: "",
      sqlServerUser: "",
      sqlServerPassword: "",
    };
  }
  return config.value.sqlServerDataAdapterProperties;
}

function ensureDb2Config(): Db2AdapterConfig {
  if (!config.value.db2DataAdapterProperties) {
    config.value.db2DataAdapterProperties = { db2Url: "", db2User: "", db2Password: "" };
  }
  return config.value.db2DataAdapterProperties;
}

function ensureDmConfig(): DmAdapterConfig {
  if (!config.value.dmDataAdapterProperties) {
    config.value.dmDataAdapterProperties = { dmUrl: "", dmUser: "", dmPassword: "" };
  }
  return config.value.dmDataAdapterProperties;
}

function ensureGaussDBConfig(): GaussDBAdapterConfig {
  if (!config.value.gaussDBDataAdapterProperties) {
    config.value.gaussDBDataAdapterProperties = {
      gaussDBUrl: "",
      gaussDBUser: "",
      gaussDBPassword: "",
    };
  }
  return config.value.gaussDBDataAdapterProperties;
}

function ensureDuckDBConfig(): DuckDBAdapterConfig {
  if (!config.value.duckDBDataAdapterProperties) {
    config.value.duckDBDataAdapterProperties = { duckdbUrl: "" };
  }
  return config.value.duckDBDataAdapterProperties;
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
            <el-radio v-if="extraAdapter" :value="extraAdapter.mode">{{ t(extraAdapter.labelKey) }}</el-radio>
            <el-radio value="mysql">{{ t("admin.mysqlMode") }}</el-radio>
            <el-radio value="postgre">{{ t("admin.postgreMode") }}</el-radio>
            <el-radio value="oracle">{{ t("admin.oracleMode") }}</el-radio>
            <el-radio value="sqlserver">{{ t("admin.sqlserverMode") }}</el-radio>
            <el-radio value="db2">{{ t("admin.db2Mode") }}</el-radio>
            <el-radio value="dm">{{ t("admin.dmMode") }}</el-radio>
            <el-radio value="gaussdb">{{ t("admin.gaussdbMode") }}</el-radio>
            <el-radio value="duckdb">{{ t("admin.duckdbMode") }}</el-radio>
          </el-radio-group>
        </el-form-item>

        <template v-if="mode === 'mysql'">
          <el-row :gutter="24">
            <el-col :span="adapterDisplay.urlSpan">
              <el-form-item label="MySQL URL">
                <el-input
                  v-model="ensureMysqlConfig().mysqlUrl"
                  placeholder="jdbc:mysql://host:port/db?useSSL=false"
                />
              </el-form-item>
            </el-col>
          </el-row>
          <el-row :gutter="24">
            <el-col :span="adapterDisplay.credentialSpan">
              <el-form-item :label="t('common.username')">
                <el-input v-model="ensureMysqlConfig().mysqlUser" placeholder="root" />
              </el-form-item>
            </el-col>
            <el-col :span="adapterDisplay.credentialSpan">
              <el-form-item :label="t('common.password')">
                <el-input
                  v-model="ensureMysqlConfig().mysqlPassword"
                  type="password"
                  placeholder="******"
                  show-password
                />
              </el-form-item>
            </el-col>
          </el-row>
        </template>

        <template v-if="mode === 'postgre'">
          <el-row :gutter="24">
            <el-col :span="adapterDisplay.urlSpan">
              <el-form-item label="PostgreSQL URL">
                <el-input
                  v-model="ensurePgsqlConfig().pgsqlUrl"
                  :placeholder="adapterDisplay.postgrePlaceholder"
                />
              </el-form-item>
            </el-col>
          </el-row>
          <el-row :gutter="24">
            <el-col :span="adapterDisplay.credentialSpan">
              <el-form-item :label="t('common.username')">
                <el-input v-model="ensurePgsqlConfig().pgsqlUser" placeholder="postgres" />
              </el-form-item>
            </el-col>
            <el-col :span="adapterDisplay.credentialSpan">
              <el-form-item :label="t('common.password')">
                <el-input
                  v-model="ensurePgsqlConfig().pgsqlPassword"
                  type="password"
                  placeholder="******"
                  show-password
                />
              </el-form-item>
            </el-col>
          </el-row>
        </template>

        <template v-if="mode === 'oracle'">
          <el-row :gutter="24">
            <el-col :span="adapterDisplay.urlSpan">
              <el-form-item label="Oracle URL">
                <el-input
                  v-model="ensureOracleConfig().oracleUrl"
                  placeholder="jdbc:oracle:thin:@//host:port/service"
                />
              </el-form-item>
            </el-col>
          </el-row>
          <el-row :gutter="24">
            <el-col :span="adapterDisplay.credentialSpan">
              <el-form-item :label="t('common.username')">
                <el-input v-model="ensureOracleConfig().oracleUser" placeholder="system" />
              </el-form-item>
            </el-col>
            <el-col :span="adapterDisplay.credentialSpan">
              <el-form-item :label="t('common.password')">
                <el-input
                  v-model="ensureOracleConfig().oraclePassword"
                  type="password"
                  placeholder="******"
                  show-password
                />
              </el-form-item>
            </el-col>
          </el-row>
        </template>

        <template v-if="mode === 'sqlserver'">
          <el-row :gutter="24">
            <el-col :span="adapterDisplay.urlSpan">
              <el-form-item label="SQL Server URL">
                <el-input
                  v-model="ensureSqlServerConfig().sqlServerUrl"
                  placeholder="jdbc:sqlserver://host:port;database=db"
                />
              </el-form-item>
            </el-col>
          </el-row>
          <el-row :gutter="24">
            <el-col :span="adapterDisplay.credentialSpan">
              <el-form-item :label="t('common.username')">
                <el-input v-model="ensureSqlServerConfig().sqlServerUser" placeholder="sa" />
              </el-form-item>
            </el-col>
            <el-col :span="adapterDisplay.credentialSpan">
              <el-form-item :label="t('common.password')">
                <el-input
                  v-model="ensureSqlServerConfig().sqlServerPassword"
                  type="password"
                  placeholder="******"
                  show-password
                />
              </el-form-item>
            </el-col>
          </el-row>
        </template>

        <template v-if="mode === 'db2'">
          <el-row :gutter="24">
            <el-col :span="adapterDisplay.urlSpan">
              <el-form-item label="DB2 URL">
                <el-input
                  v-model="ensureDb2Config().db2Url"
                  placeholder="jdbc:db2://host:port/db"
                />
              </el-form-item>
            </el-col>
          </el-row>
          <el-row :gutter="24">
            <el-col :span="adapterDisplay.credentialSpan">
              <el-form-item :label="t('common.username')">
                <el-input v-model="ensureDb2Config().db2User" placeholder="db2inst1" />
              </el-form-item>
            </el-col>
            <el-col :span="adapterDisplay.credentialSpan">
              <el-form-item :label="t('common.password')">
                <el-input
                  v-model="ensureDb2Config().db2Password"
                  type="password"
                  placeholder="******"
                  show-password
                />
              </el-form-item>
            </el-col>
          </el-row>
        </template>

        <template v-if="mode === 'dm'">
          <el-row :gutter="24">
            <el-col :span="adapterDisplay.urlSpan">
              <el-form-item :label="adapterDisplay.damengLabel">
                <el-input v-model="ensureDmConfig().dmUrl" placeholder="jdbc:dm://host:port/db" />
              </el-form-item>
            </el-col>
          </el-row>
          <el-row :gutter="24">
            <el-col :span="adapterDisplay.credentialSpan">
              <el-form-item :label="t('common.username')">
                <el-input v-model="ensureDmConfig().dmUser" placeholder="SYSDBA" />
              </el-form-item>
            </el-col>
            <el-col :span="adapterDisplay.credentialSpan">
              <el-form-item :label="t('common.password')">
                <el-input
                  v-model="ensureDmConfig().dmPassword"
                  type="password"
                  placeholder="******"
                  show-password
                />
              </el-form-item>
            </el-col>
          </el-row>
        </template>

        <template v-if="mode === 'gaussdb'">
          <el-row :gutter="24">
            <el-col :span="adapterDisplay.urlSpan">
              <el-form-item label="GaussDB URL">
                <el-input
                  v-model="ensureGaussDBConfig().gaussDBUrl"
                  placeholder="jdbc:postgresql://host:port/db"
                />
              </el-form-item>
            </el-col>
          </el-row>
          <el-row :gutter="24">
            <el-col :span="adapterDisplay.credentialSpan">
              <el-form-item :label="t('common.username')">
                <el-input v-model="ensureGaussDBConfig().gaussDBUser" placeholder="gaussdb" />
              </el-form-item>
            </el-col>
            <el-col :span="adapterDisplay.credentialSpan">
              <el-form-item :label="t('common.password')">
                <el-input
                  v-model="ensureGaussDBConfig().gaussDBPassword"
                  type="password"
                  placeholder="******"
                  show-password
                />
              </el-form-item>
            </el-col>
          </el-row>
        </template>

        <template v-if="mode === 'duckdb'">
          <el-row :gutter="24">
            <el-col :span="adapterDisplay.urlSpan">
              <el-form-item label="DuckDB URL">
                <el-input
                  v-model="ensureDuckDBConfig().duckdbUrl"
                  placeholder="jdbc:duckdb:/data/example.duckdb"
                />
                <el-text type="info" size="small">{{ t("admin.duckdbUrlHint") }}</el-text>
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
