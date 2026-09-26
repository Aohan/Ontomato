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
 * 工作区实例的提示与确认：消息挂在本实例根元素内（跟随本实例主题），确认框是本实例内的声明式对话框。
 * 工作区卸载（宿主换了 API 入口或凭据、或组件被移除）时关闭本实例的消息、按取消结束未答复的确认，
 * 之后的调用不再显示；不影响同页其他 Manager 实例，也不改 html/body。
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

  /** 与原 ElMessageBox.confirm 相同的约定：确认时 resolve，取消或关闭时以 "cancel" reject。 */
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

/** 由工作区在 setup 中调用一次；target 是工作区根元素。 */
export function provideManagerFeedback(target: Ref<HTMLElement | undefined>) {
  const feedback = createManagerFeedback(target);
  provide(feedbackKey, feedback);
  onBeforeUnmount(feedback.close);
  return feedback;
}

export function useManagerFeedback() {
  const feedback = inject(feedbackKey);
  if (!feedback) throw new Error("Ontology Manager 组件必须挂载在工作区内");
  return feedback;
}
