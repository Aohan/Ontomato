import { onUnmounted, ref } from "vue";
import type {
  GovernanceSession,
  GovernanceSummary,
  GovernanceSourceRead,
} from "@ontomato/contracts/knowledge-governance";
import { governanceApi } from "./api";

export function useGovernance() {
  const session = ref<GovernanceSession | null>(null);
  const rounds = ref<GovernanceSummary[]>([]);
  const loading = ref(false),
    sending = ref(false),
    stopping = ref(false);
  const error = ref("");
  const source = ref<GovernanceSourceRead | null>(null);
  let generation = 0,
    sourceGeneration = 0;
  let controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const apply = (next: GovernanceSession) => {
    if (session.value?.id === next.id && session.value.revision > next.revision) return;
    session.value = next;
    if (next.status !== "running") stopping.value = false;
  };
  const failed = (reason: unknown, owner: number) => {
    if (generation === owner && !controller.signal.aborted)
      error.value = reason instanceof Error ? reason.message : String(reason);
  };
  function schedule(id: string, owner: number) {
    clearTimeout(timer);
    if (generation !== owner || session.value?.status !== "running") return;
    timer = setTimeout(() => {
      void refresh(id, owner);
    }, 1000);
  }
  async function refresh(id: string, owner: number) {
    try {
      const next = await governanceApi.read(id, controller.signal);
      if (generation === owner) {
        apply(next);
        error.value = "";
      }
    } catch (reason) {
      failed(reason, owner);
    } finally {
      schedule(id, owner);
    }
  }
  async function select(id?: string) {
    const owner = ++generation;
    controller.abort();
    controller = new AbortController();
    clearTimeout(timer);
    session.value = null;
    source.value = null;
    ++sourceGeneration;
    error.value = "";
    loading.value = true;
    sending.value = false;
    stopping.value = false;
    try {
      const [list, next] = await Promise.all([
        governanceApi.list(controller.signal),
        id ? governanceApi.read(id, controller.signal) : Promise.resolve(null),
      ]);
      if (generation !== owner) return;
      rounds.value = list;
      if (next) apply(next);
    } catch (reason) {
      failed(reason, owner);
    } finally {
      if (generation === owner) {
        loading.value = false;
        if (id) schedule(id, owner);
      }
    }
  }
  async function start() {
    const owner = generation;
    sending.value = true;
    error.value = "";
    try {
      const next = await governanceApi.start(controller.signal);
      if (owner === generation) return next.id;
    } catch (reason) {
      failed(reason, owner);
    } finally {
      if (owner === generation) sending.value = false;
    }
  }
  async function respond(message: string) {
    const id = session.value?.id,
      owner = generation;
    if (!id || !message.trim() || session.value?.status === "running" || sending.value)
      return false;
    sending.value = true;
    error.value = "";
    try {
      const next = await governanceApi.respond(id, message, controller.signal);
      if (owner !== generation) return false;
      apply(next);
      schedule(id, owner);
      return true;
    } catch (reason) {
      failed(reason, owner);
      return false;
    } finally {
      if (owner === generation) sending.value = false;
    }
  }
  async function stop() {
    const id = session.value?.id,
      owner = generation;
    if (!id || stopping.value) return;
    stopping.value = true;
    try {
      await governanceApi.stop(id, controller.signal);
    } catch (reason) {
      failed(reason, owner);
      if (owner === generation) stopping.value = false;
    }
  }
  async function readSource(id: string, offset = 0) {
    const current = session.value?.id,
      owner = generation,
      sourceOwner = ++sourceGeneration;
    if (!current) return;
    try {
      const next = await governanceApi.source(current, id, offset, controller.signal);
      if (owner === generation && sourceOwner === sourceGeneration) source.value = next;
    } catch (reason) {
      failed(reason, owner);
    }
  }
  onUnmounted(() => {
    ++generation;
    controller.abort();
    clearTimeout(timer);
  });
  return {
    session,
    rounds,
    loading,
    sending,
    stopping,
    error,
    source,
    select,
    start,
    respond,
    stop,
    readSource,
  };
}
