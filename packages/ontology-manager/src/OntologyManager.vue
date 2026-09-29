<script setup lang="ts">
import { computed, onMounted, provide, ref } from "vue";
import { ElConfigProvider, ID_INJECTION_KEY, useGetDerivedNamespace } from "element-plus";
import { hostSource, type ManagerAuthFailureStatus } from "./api";
import type { ManagerHostContext } from "./context";
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
 * One Element Plus id prefix per instance: dropdowns, selects, tooltips and other poppers find their popper container by prefix,
 * so the container sits inside this instance's root; poppers inherit this instance's theme variables and unmount with it.
 */
const idPrefix = nextElementIdPrefix();
provide(ID_INJECTION_KEY, { prefix: idPrefix, current: 0 });
const namespace = useGetDerivedNamespace();
const popperContainerId = computed(() => `${namespace.value}-popper-container-${idPrefix}`);

// Poppers look up their container by id when mounted; render the workspace only after the container is in the document so EP does not create another one under body.
const rootMounted = ref(false);
onMounted(() => (rootMounted.value = true));

/*
 * An API entry or credential change means a different data source or user: the workspace is rebuilt, and old data, poppers and request follow-ups end with the old instance.
 * Locale/theme-only changes do not rebuild, so open edits stay; in-flight requests are delivered as usual and later requests carry the new locale.
 */
const workspaceKey = computed(() => hostSource(props));
</script>

<template>
  <el-config-provider :locale="messages.element">
    <!-- Host-supplied presentation values bind to the real root element (ElConfigProvider renders no element), so EP derived variables and poppers in this instance evaluate against them. -->
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
  /* This instance's overlays, dialogs and messages are positioned within the component root and do not cover the host page or another instance on the same page. */
  contain: layout;
  /* Breakpoints and cqw/cqh limits use the component size given by the host, not the viewport, so the host must give the component a container with a definite size. */
  container: ontology-manager / size;
}
</style>
