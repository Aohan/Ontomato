<script setup lang="ts">
import { computed, onMounted, provide, ref } from "vue";
import { ElConfigProvider, ID_INJECTION_KEY, useGetDerivedNamespace } from "element-plus";
import { hostSource, type ManagerAuthFailureStatus } from "./api";
import type { ManagerHostContext } from "./context";
import { elementLocale } from "./i18n";
import { nextElementIdPrefix } from "./instance-id";
import ManagerWorkspace from "./ManagerWorkspace.vue";
import "./theme.css";
import "./style.css";

const props = defineProps<ManagerHostContext>();
const emit = defineEmits<{
  "update:view": [view: string];
  "auth-failure": [status: ManagerAuthFailureStatus];
}>();

/*
 * 每个实例一个 Element Plus id 前缀：下拉、选择、提示等弹层按前缀查找 popper 容器，
 * 这里把容器放在本实例根内，弹层因此继承本实例的主题变量，也随本实例卸载。
 */
const idPrefix = nextElementIdPrefix();
provide(ID_INJECTION_KEY, { prefix: idPrefix, current: 0 });
const namespace = useGetDerivedNamespace();
const popperContainerId = computed(() => `${namespace.value}-popper-container-${idPrefix}`);

// 弹层在挂载时按 id 查找容器；容器进入文档后再渲染工作区，EP 才不会另在 body 下创建。
const rootMounted = ref(false);
onMounted(() => (rootMounted.value = true));

/*
 * API 入口或凭据变化：换了数据来源或用户，工作区重建，旧数据、旧弹层与旧请求后续随旧实例结束。
 * 仅 locale/theme 变化不重建，打开的编辑保持；在途请求照常交付，之后的请求带新语言。
 */
const workspaceKey = computed(() => hostSource(props));
</script>

<template>
  <el-config-provider :locale="elementLocale(locale)">
    <!-- 宿主给的两版原值绑在真实根元素上（ElConfigProvider 不渲染元素），本实例内的 EP 派生变量与弹层随之求值。 -->
    <div
      :class="[
        'ontology-manager',
        { 'is-dark': theme === 'dark', 'is-compact-dialogs': presentation.compactDialogs },
      ]"
      :style="presentation.themeProperties[theme]"
      :lang="locale"
      :dir="locale === 'ar' ? 'rtl' : 'ltr'"
    >
      <div :id="popperContainerId" />
      <ManagerWorkspace
        v-if="credential && rootMounted"
        :key="workspaceKey"
        :context="props"
        @navigate="emit('update:view', $event)"
        @auth-failure="emit('auth-failure', $event)"
      />
    </div>
  </el-config-provider>
</template>

<style scoped>
.ontology-manager {
  height: 100%;
  /* 本实例的遮罩、对话框与消息以组件根为定位容器，不覆盖宿主页面或同页另一个实例。 */
  contain: layout;
  /* 断点与 cqw/cqh 上限按宿主给的组件尺寸计算，而不是按视口；因此宿主须给组件一个有确定尺寸的容器。 */
  container: ontology-manager / size;
}
</style>
