<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { useTheme } from "../../../composables/useTheme";
import {
  avatarIconOptions,
  lightAvatarColorOptions,
  darkAvatarColorOptions,
} from "../utils/agentDisplay";

const name = defineModel<string>("name", { required: true });
const description = defineModel<string>("description", { required: true });
const avatarKey = defineModel<string>("avatarKey", { required: true });
const avatarColor = defineModel<string>("avatarColor", { required: true });
withDefaults(
  defineProps<{
    nameRequired?: boolean;
    namePlaceholder?: string;
    descriptionPlaceholder?: string;
    nameMaxlength?: number;
    descriptionMaxlength?: number;
    defaultAvatarKey?: string;
  }>(),
  { nameRequired: true, defaultAvatarKey: "Brain" }
);
const { t } = useI18n();
const { isDark } = useTheme();
const colors = computed(() => (isDark.value ? darkAvatarColorOptions : lightAvatarColorOptions));
</script>

<template>
  <el-form-item :label="t('common.name')" :required="nameRequired">
    <el-input
      v-model="name"
      :maxlength="nameMaxlength"
      :placeholder="namePlaceholder || t('admin.agentNameHint')"
    />
  </el-form-item>
  <el-form-item :label="t('common.description')">
    <el-input
      v-model="description"
      type="textarea"
      :rows="2"
      :maxlength="descriptionMaxlength"
      :placeholder="descriptionPlaceholder || t('admin.agentDescHint')"
    />
  </el-form-item>
  <slot />
  <el-form-item :label="t('common.avatar')">
    <div class="admin-avatar-picker">
      <button
        v-for="option in avatarIconOptions"
        :key="option.key"
        type="button"
        class="admin-avatar-option"
        :class="{ active: (avatarKey || defaultAvatarKey) === option.key }"
        :title="option.key"
        :aria-label="option.key"
        :aria-pressed="(avatarKey || defaultAvatarKey) === option.key"
        @click="avatarKey = option.key"
      >
        <component :is="option.icon" :size="18" />
      </button>
    </div>
  </el-form-item>
  <el-form-item :label="t('common.color')">
    <div class="admin-avatar-picker">
      <button
        v-for="color in colors"
        :key="color"
        type="button"
        class="admin-avatar-color-option"
        :class="{ active: (avatarColor || colors[0]) === color }"
        :style="{ background: color }"
        :aria-label="color"
        :aria-pressed="(avatarColor || colors[0]) === color"
        @click="avatarColor = color"
      />
    </div>
  </el-form-item>
</template>

<style scoped>
.admin-avatar-picker {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.admin-avatar-option {
  width: 36px;
  height: 36px;
  border: 1.5px solid var(--el-border-color);
  border-radius: 10px;
  background: var(--el-fill-color-extra-light);
  color: var(--el-color-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.16s ease;
  padding: 0;
}
.admin-avatar-option:hover,
.admin-avatar-option.active {
  border-color: color-mix(in srgb, var(--el-color-primary) 50%, transparent);
  background: var(--el-color-primary-light-9);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--el-color-primary) 8%, transparent);
}

.admin-avatar-color-option {
  width: 36px;
  height: 36px;
  border: 2px solid transparent;
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.16s ease;
  padding: 0;
}
.admin-avatar-color-option:hover {
  transform: scale(1.1);
}
.admin-avatar-color-option.active {
  border-color: var(--el-color-primary);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--el-color-primary) 15%, transparent);
}

button:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 3px;
}
</style>
