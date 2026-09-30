<template>
  <el-dropdown
    v-bind="attrs"
    :trigger="trigger"
    :hide-on-click="hideOnClick"
    @command="onCommand"
    @visible-change="onVisibleChange"
  >
    <component
      :is="as"
      :class="triggerClass"
      :type="as === 'button' ? 'button' : undefined"
      :title="title"
      @click.stop
    >
      <MoreHorizontal :size="iconSize || 16" :color="iconColor || undefined" />
    </component>

    <template #dropdown>
      <el-dropdown-menu>
        <!-- Shown only in the dimension menu -->
        <template v-if="scene === 'dimension'">
          <el-dropdown-item command="create_above">
            {{ t("dashboard.createDimensionAbove") }}
          </el-dropdown-item>
          <el-dropdown-item command="create_below">
            {{ t("dashboard.createDimensionBelow") }}
          </el-dropdown-item>
          <el-dropdown-item command="rename" divided>{{ t("common.rename") }}</el-dropdown-item>
          <el-dropdown-item command="delete">{{ t("common.delete") }}</el-dropdown-item>
        </template>

        <!-- Default chart/metric menu (no create-dimension entry) -->
        <template v-else>
          <el-dropdown-item command="rename">{{ t("common.rename") }}</el-dropdown-item>
          <el-dropdown-item v-if="scene === 'metric'" command="view_dsl">
            {{ t("common.viewDsl") }}
          </el-dropdown-item>
          <el-dropdown-item command="delete" divided>{{ t("common.delete") }}</el-dropdown-item>
        </template>
      </el-dropdown-menu>
    </template>
  </el-dropdown>
</template>

<script setup>
import { useAttrs } from "vue";
import { MoreHorizontal } from "lucide-vue-next";
import { useI18n } from "vue-i18n";

const { t } = useI18n();

defineOptions({ inheritAttrs: false });

defineProps({
  trigger: { type: String, default: "click" },
  hideOnClick: { type: Boolean, default: true },
  as: { type: String, default: "span" },
  triggerClass: { type: String, default: "" },
  title: { type: String, default: "" },
  iconColor: { type: String, default: "" },
  iconSize: { type: [Number, String], default: undefined },
  scene: { type: String, default: "" }, // 'dimension' | 'metric' | ''(default: chart)
});

const emit = defineEmits(["command", "visible-change"]);
const attrs = useAttrs();

function onCommand(cmd) {
  emit("command", cmd);
}

function onVisibleChange(v) {
  emit("visible-change", v);
}
</script>
