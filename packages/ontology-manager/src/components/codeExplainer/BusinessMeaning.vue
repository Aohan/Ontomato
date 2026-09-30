<script setup lang="ts">
import type { BusinessMeaning } from "./codeSegments";
import { useOntologyText } from "../../context";

/*
 * Business meaning display: receives only the normalized business meaning and whether there are unsaved changes;
 * calls no API and reads no global state. The caller omits the whole section when both parts are empty.
 */
defineProps<{ meaning: BusinessMeaning | null; stale: boolean }>();

const { ot } = useOntologyText();
</script>

<template>
  <section v-if="meaning" class="business-meaning">
    <h3 class="bm-title">{{ ot("sectionBusinessMeaning") }}</h3>
    <p v-if="stale" class="bm-stale">{{ ot("businessMeaningStale") }}</p>
    <div v-if="meaning.operations.length > 0" class="bm-part">
      <h4>{{ ot("detailOperations") }}</h4>
      <ul class="bm-ops">
        <li v-for="(operation, index) in meaning.operations" :key="index">
          {{ operation }}
        </li>
      </ul>
    </div>
    <div v-if="meaning.negativeEffect" class="bm-part">
      <h4>{{ ot("detailConsequences") }}</h4>
      <div class="bm-warning">{{ meaning.negativeEffect }}</div>
    </div>
  </section>
</template>

<style scoped>
.business-meaning {
  margin-top: var(--spacing-xl);
}
.bm-title {
  margin: 0;
  color: var(--el-text-color-primary);
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
}
.bm-stale {
  margin: var(--spacing-xs) 0 0;
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
}
.bm-part h4 {
  margin: var(--spacing-md) 0 var(--spacing-xs);
  color: var(--el-text-color-secondary);
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
}
.bm-ops {
  margin: 0;
  padding-left: 20px;
  color: var(--el-text-color-primary);
  font-size: var(--text-sm);
  line-height: 1.6;
}
.bm-ops li + li {
  margin-top: var(--spacing-xs);
}
.bm-warning {
  padding: var(--spacing-sm) var(--spacing-md);
  border-radius: var(--radius-sm);
  border-left: 3px solid var(--el-color-warning);
  background: var(--el-color-warning-light-9);
  color: var(--el-text-color-primary);
  font-size: var(--text-sm);
  line-height: 1.6;
}
</style>
