<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";

const { t } = useI18n();

defineProps<{
  visible: boolean;
}>();

const emit = defineEmits<{
  close: [];
  save: [
    settings: {
      frequency: string;
      time: string;
      dayOfWeek: number;
      dayOfMonth: number;
      emailNotify: boolean;
      emails: string;
    },
  ];
}>();

const frequency = ref(t("task.daily"));
const execTime = ref("08:00");
const dayOfWeek = ref(1);
const dayOfMonth = ref(1);
const emailNotify = ref(false);
const emails = ref("");

const frequencyOptions = [
  { label: t("task.daily"), value: t("task.daily") },
  { label: t("task.weekly"), value: t("task.weekly") },
  { label: t("task.monthly"), value: t("task.monthly") },
];

const timeOptions = [
  "00:00",
  "00:30",
  "01:00",
  "01:30",
  "02:00",
  "02:30",
  "03:00",
  "03:30",
  "04:00",
  "04:30",
  "05:00",
  "05:30",
  "06:00",
  "06:30",
  "07:00",
  "07:30",
  "08:00",
  "08:30",
  "09:00",
  "09:30",
  "10:00",
  "10:30",
  "11:00",
  "11:30",
  "12:00",
  "12:30",
  "13:00",
  "13:30",
  "14:00",
  "14:30",
  "15:00",
  "15:30",
  "16:00",
  "16:30",
  "17:00",
  "17:30",
  "18:00",
  "18:30",
  "19:00",
  "19:30",
  "20:00",
  "20:30",
  "21:00",
  "21:30",
  "22:00",
  "22:30",
  "23:00",
  "23:30",
];

const dayOfWeekOptions = [
  { label: t("common.monday"), value: 1 },
  { label: t("common.tuesday"), value: 2 },
  { label: t("common.wednesday"), value: 3 },
  { label: t("common.thursday"), value: 4 },
  { label: t("common.friday"), value: 5 },
  { label: t("common.saturday"), value: 6 },
  { label: t("common.sunday"), value: 7 },
];

const dayOfMonthOptions = [1, 5, 10, 15, 20, 25];

function handleSave() {
  emit("save", {
    frequency: frequency.value,
    time: execTime.value,
    dayOfWeek: dayOfWeek.value,
    dayOfMonth: dayOfMonth.value,
    emailNotify: emailNotify.value,
    emails: emails.value,
  });
}
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="overlay" @click.self="emit('close')">
      <div class="timer-dropdown">
        <div class="timer-header">
          <span class="timer-title">{{ t("analysis.scheduledExecution") }}</span>
          <el-button :icon="'Close'" circle size="small" text @click="emit('close')" />
        </div>

        <div class="timer-body">
          <div class="form-group">
            <label class="form-label">{{ t("analysis.frequency") }}</label>
            <el-select v-model="frequency" size="small" class="form-full">
              <el-option
                v-for="opt in frequencyOptions"
                :key="opt.value"
                :label="opt.label"
                :value="opt.value"
              />
            </el-select>
          </div>

          <div v-if="frequency === t('task.weekly')" class="form-group">
            <label class="form-label">{{ t("analysis.dayOfWeek") }}</label>
            <el-select v-model="dayOfWeek" size="small" class="form-full">
              <el-option
                v-for="d in dayOfWeekOptions"
                :key="d.value"
                :label="d.label"
                :value="d.value"
              />
            </el-select>
          </div>

          <div v-if="frequency === t('task.monthly')" class="form-group">
            <label class="form-label">{{ t("common.date") }}</label>
            <el-select v-model="dayOfMonth" size="small" class="form-full">
              <el-option
                v-for="d in dayOfMonthOptions"
                :key="d"
                :label="t('analysis.monthlyDayFormat', { day: d })"
                :value="d"
              />
            </el-select>
          </div>

          <div class="form-group">
            <label class="form-label">{{ t("analysis.time") }}</label>
            <el-select v-model="execTime" size="small" class="form-full" filterable>
              <el-option v-for="opt in timeOptions" :key="opt" :label="opt" :value="opt" />
            </el-select>
          </div>

          <div class="form-group">
            <div class="toggle-row">
              <label class="form-label">{{ t("analysis.emailNotification") }}</label>
              <el-switch v-model="emailNotify" size="small" />
            </div>
          </div>

          <div v-if="emailNotify" class="form-group">
            <el-input v-model="emails" size="small" :placeholder="t('analysis.emailPlaceholder')" />
          </div>
        </div>

        <div class="timer-footer">
          <el-button size="small" class="form-full" @click="emit('close')">
            {{ t("common.cancel") }}
          </el-button>
          <el-button size="small" type="primary" class="form-full" @click="handleSave">
            {{ t("common.save") }}
          </el-button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  z-index: 2000;
  display: flex;
  align-items: flex-start;
  justify-content: flex-end;
  padding: 60px 24px 0 0;
}

.timer-dropdown {
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-light);
  border-radius: 12px;
  padding: 20px;
  width: 300px;
  box-shadow: 0 4px 24px var(--shadow-dropdown);
  animation: dropdownIn 0.2s ease;
}

@keyframes dropdownIn {
  from {
    opacity: 0;
    transform: translateY(-8px) scale(0.97);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

.timer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}

.timer-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.timer-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.form-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--el-text-color-regular);
}

.form-full {
  width: 100%;
}

.toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.timer-footer {
  display: flex;
  gap: 8px;
  margin-top: 18px;
}
@media (max-width: 700px) {
  :where(html.workbench-mobile-navigation) .overlay {
    align-items: flex-end;
    justify-content: stretch;
    padding: 0;
    background: color-mix(in srgb, #000 28%, transparent);
  }
  :where(html.workbench-mobile-navigation) .timer-dropdown {
    width: 100%;
    max-height: 85dvh;
    overflow-y: auto;
    padding: 18px 16px calc(16px + env(safe-area-inset-bottom));
    border-width: 1px 0 0;
    border-radius: 16px 16px 0 0;
    animation-name: sheetIn;
  }
  @keyframes sheetIn {
    from {
      opacity: 0;
      transform: translateY(24px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
}
</style>
