import { watch } from "vue";
import { storeToRefs } from "pinia";
import { t } from "../../../i18n";
import { useDiagnosisChatStore } from "../stores/agent-chat";

export function formatToolResult(result: unknown): string {
  if (result == null) return t("diagnosis.noResult");
  if (typeof result === "string") return result;
  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return String(result);
  }
}

export function formatToolArgs(args: string): string {
  if (!args) return "";
  try {
    return JSON.stringify(JSON.parse(args), null, 2);
  } catch {
    return args;
  }
}

export function truncateTitle(text: string, max = 30): string {
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

export interface UseAgentChatOptions {
  onStreamUpdate?: () => void;
}

export function useAgentChat(options: UseAgentChatOptions = {}) {
  const store = useDiagnosisChatStore();
  const refs = storeToRefs(store);
  const stopWatching = options.onStreamUpdate
    ? watch(
        refs.messages,
        () => {
          options.onStreamUpdate?.();
        },
        { deep: true, flush: "post" }
      )
    : () => {};

  return {
    ...refs,
    loadSessions: store.loadSessions,
    createSession: store.createSession,
    deleteSession: store.deleteSession,
    selectSession: store.selectSession,
    clearSession: store.clearSession,
    sendMessage: store.sendMessage,
    stopSending: store.stopSending,
    cleanup: stopWatching,
  };
}
