import {
  inject,
  onBeforeUnmount,
  provide,
  shallowReactive,
  type InjectionKey,
  type Ref,
} from "vue";
import { ElMessage, type MessageHandler } from "element-plus";

type MessageType = "success" | "warning" | "info" | "error";

interface PendingConfirm {
  message: string;
  title: string;
  settle: (confirmed: boolean) => void;
}

/**
 * Messages and confirmations for a workspace instance: messages mount inside this instance's root element (following its
 * theme) and confirmations are declarative dialogs inside the instance. When the workspace unmounts (the host changed API
 * entry or credential, or the component was removed), its messages close, unanswered confirmations end as cancelled and
 * later calls show nothing; other Manager instances on the page and html/body are unaffected.
 */
function createManagerFeedback(target: Ref<HTMLElement | undefined>) {
  const handles = new Set<MessageHandler>();
  const state = shallowReactive<{ pending: PendingConfirm | null }>({ pending: null });
  let closed = false;

  function show(type: MessageType, text: string) {
    if (closed) return;
    const handle = ElMessage({
      type,
      message: text,
      appendTo: target.value,
      onClose: () => handles.delete(handle),
    });
    handles.add(handle);
  }

  /** Same contract as the original ElMessageBox.confirm: resolves on confirm, rejects with "cancel" on cancel or close. */
  function confirm(message: string, title: string) {
    return new Promise<void>((resolve, reject) => {
      state.pending = {
        message,
        title,
        settle: (confirmed) => {
          state.pending = null;
          if (confirmed) resolve();
          else reject("cancel");
        },
      };
    });
  }

  function close() {
    closed = true;
    state.pending?.settle(false);
    handles.forEach((handle) => handle.close());
  }

  return {
    state,
    confirm,
    close,
    message: {
      success: (text: string) => show("success", text),
      warning: (text: string) => show("warning", text),
      info: (text: string) => show("info", text),
      error: (text: string) => show("error", text),
    },
  };
}

export type ManagerFeedback = ReturnType<typeof createManagerFeedback>;

const feedbackKey: InjectionKey<ManagerFeedback> = Symbol("ontology-manager-feedback");

/** Called once by the workspace in setup; target is the workspace root element. */
export function provideManagerFeedback(target: Ref<HTMLElement | undefined>) {
  const feedback = createManagerFeedback(target);
  provide(feedbackKey, feedback);
  onBeforeUnmount(feedback.close);
  return feedback;
}

export function useManagerFeedback() {
  const feedback = inject(feedbackKey);
  if (!feedback) throw new Error("Ontology Manager components must be mounted inside the workspace");
  return feedback;
}
