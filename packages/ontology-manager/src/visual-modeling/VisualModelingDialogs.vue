<script setup lang="ts">
import { computed } from "vue";
import {
  ElButton,
  ElDialog,
  ElForm,
  ElFormItem,
  ElIcon,
  ElInput,
  ElOption,
  ElSelect,
  ElTooltip,
} from "element-plus";
import { CircleHelp } from "lucide-vue-next";
import { useOntologyText, useSharedText } from "../context";

interface ClassDef {
  className: string;
  showName: string;
  classDesc: string;
}

interface RelationDef {
  relationship: string;
  fromclass: string;
  toclass: string;
  desc: string;
  fromField?: string;
  toField?: string;
  isNew?: boolean;
}

const props = defineProps<{
  nodeVisible: boolean;
  edgeVisible: boolean;
  editingNode: ClassDef | null;
  editingEdge: RelationDef | null;
  classList: ClassDef[];
  showJoinFields: boolean;
  newNodeName: string;
  newNodeShowName: string;
  newNodeDesc: string;
  newNodePrimaryKey: string;
  newEdgeDesc: string;
  newEdgeFromField: string;
  newEdgeToField: string;
}>();

const emit = defineEmits<{
  "update:nodeVisible": [value: boolean];
  "update:edgeVisible": [value: boolean];
  "update:newNodeName": [value: string];
  "update:newNodeShowName": [value: string];
  "update:newNodeDesc": [value: string];
  "update:newNodePrimaryKey": [value: string];
  "update:newEdgeDesc": [value: string];
  "update:newEdgeFromField": [value: string];
  "update:newEdgeToField": [value: string];
  updateEdgeField: [field: "fromclass" | "toclass", value: string];
  addNode: [];
  pencilNode: [];
  addEdge: [];
  pencilEdge: [];
  cancelEdge: [];
}>();

const { t } = useSharedText();
const { ot } = useOntologyText();

const nodeVisibleModel = computed({
  get: () => props.nodeVisible,
  set: (value: boolean) => emit("update:nodeVisible", value),
});

const edgeVisibleModel = computed({
  get: () => props.edgeVisible,
  set: (value: boolean) => {
    if (!value) {
      emit("cancelEdge");
      return;
    }
    emit("update:edgeVisible", value);
  },
});

const newNodeNameModel = computed({
  get: () => props.newNodeName,
  set: (value: string) => emit("update:newNodeName", value),
});

const newNodeShowNameModel = computed({
  get: () => props.newNodeShowName,
  set: (value: string) => emit("update:newNodeShowName", value),
});

const newNodeDescModel = computed({
  get: () => props.newNodeDesc,
  set: (value: string) => emit("update:newNodeDesc", value),
});

const newNodePrimaryKeyModel = computed({
  get: () => props.newNodePrimaryKey,
  set: (value: string) => emit("update:newNodePrimaryKey", value),
});

const newEdgeDescModel = computed({
  get: () => props.newEdgeDesc,
  set: (value: string) => emit("update:newEdgeDesc", value),
});

const newEdgeFromFieldModel = computed({
  get: () => props.newEdgeFromField,
  set: (value: string) => emit("update:newEdgeFromField", value),
});

const newEdgeToFieldModel = computed({
  get: () => props.newEdgeToField,
  set: (value: string) => emit("update:newEdgeToField", value),
});
</script>

<template>
  <el-dialog
    v-model="nodeVisibleModel"
    :lock-scroll="false"
    :title="t('hotData.addPencilClass')"
    width="400px"
  >
    <el-form label-width="110px">
      <el-form-item :label="t('hotData.className')" required>
        <el-input
          v-model="newNodeNameModel"
          :disabled="editingNode !== null"
          :placeholder="t('hotData.uniqueId')"
        />
      </el-form-item>
      <el-form-item v-if="editingNode === null" :label="t('hotData.primaryKey')" required>
        <el-input v-model="newNodePrimaryKeyModel" :placeholder="ot('examplePrimaryKey')" />
      </el-form-item>
      <el-form-item :label="t('admin.displayName')" required>
        <el-input v-model="newNodeShowNameModel" :placeholder="t('hotData.chineseDisplayName')" />
      </el-form-item>
      <el-form-item :label="t('common.description')" required>
        <el-input
          v-model="newNodeDescModel"
          type="textarea"
          :placeholder="t('hotData.classDesc')"
        />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="nodeVisibleModel = false">{{ t("common.cancel") }}</el-button>
      <el-button type="primary" @click="editingNode ? emit('pencilNode') : emit('addNode')">
        {{ editingNode ? t("hotData.update") : t("common.add") }}
      </el-button>
    </template>
  </el-dialog>

  <el-dialog
    v-model="edgeVisibleModel"
    :lock-scroll="false"
    :title="t('hotData.addPencilRelation')"
    width="400px"
  >
    <el-form v-if="editingEdge" label-width="110px">
      <el-form-item :label="t('hotData.srcClass')" required>
        <el-select
          :model-value="editingEdge.fromclass"
          :disabled="!editingEdge.isNew"
          @update:model-value="emit('updateEdgeField', 'fromclass', String($event))"
        >
          <el-option
            v-for="cls in classList"
            :key="cls.className"
            :label="cls.showName"
            :value="cls.className"
          />
        </el-select>
      </el-form-item>
      <el-form-item :label="t('hotData.tgtClass')" required>
        <el-select
          :model-value="editingEdge.toclass"
          :disabled="!editingEdge.isNew"
          @update:model-value="emit('updateEdgeField', 'toclass', String($event))"
        >
          <el-option
            v-for="cls in classList"
            :key="cls.className"
            :label="cls.showName"
            :value="cls.className"
          />
        </el-select>
      </el-form-item>
      <el-form-item :label="t('hotData.relDesc')" required>
        <el-input v-model="newEdgeDescModel" :placeholder="t('hotData.relDesc')" />
      </el-form-item>
      <el-form-item v-if="showJoinFields" :label="t('hotData.srcField')" required>
        <template #label>
          <span>
            {{ t("hotData.srcField") }}
            <el-tooltip placement="top" effect="dark">
              <template #content>
                {{ t("hotData.joinFieldHint") }}
              </template>
              <el-icon style="margin-left: 2px; cursor: help"><CircleHelp /></el-icon>
            </el-tooltip>
          </span>
        </template>
        <el-input v-model="newEdgeFromFieldModel" :placeholder="t('hotData.enterSrcField')" />
      </el-form-item>
      <el-form-item v-if="showJoinFields" :label="t('hotData.tgtField')" required>
        <template #label>
          <span>
            {{ t("hotData.tgtField") }}
            <el-tooltip placement="top" effect="dark">
              <template #content>
                {{ t("hotData.joinFieldHint") }}
              </template>
              <el-icon style="margin-left: 2px; cursor: help"><CircleHelp /></el-icon>
            </el-tooltip>
          </span>
        </template>
        <el-input v-model="newEdgeToFieldModel" :placeholder="t('hotData.enterTgtField')" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="emit('cancelEdge')">{{ t("common.cancel") }}</el-button>
      <el-button
        type="primary"
        @click="editingEdge && editingEdge.isNew ? emit('addEdge') : emit('pencilEdge')"
      >
        {{ editingEdge && editingEdge.isNew ? t("common.add") : t("hotData.update") }}
      </el-button>
    </template>
  </el-dialog>
</template>
