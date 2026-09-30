import type {
  BranchKey,
  QueryThinkingState,
  ThinkingAbcState,
  ThinkingBranchState,
  ThinkingBranchCard,
  ThinkingBranchStatus,
} from "@ontomato/contracts/query-thinking";

import { t } from "../../../i18n";

interface BranchState {
  status: ThinkingBranchStatus;
  label: string;
  logs: string[];
  content?: string;
  cards?: ThinkingBranchCard[];
}

export interface ThinkingBranchView<K extends BranchKey> {
  readonly key: K;
  ensureParallelStarted: () => void;
  set: (status: ThinkingBranchStatus, label: string) => void;
  setContent: (content: string) => void;
  setCards: (cards: ThinkingBranchCard[]) => void;
  log: (message: string) => void;
}

const MAX_LINES_PER_BRANCH = 6;

export class ThinkingBuffer {
  private readonly branches: Record<BranchKey, BranchState> = {
    static: { status: "idle", label: "", logs: [] },
    hot: { status: "idle", label: "", logs: [] },
    abc: { status: "idle", label: "", logs: [] },
  };
  private readonly enabledBranches: readonly BranchKey[];
  private readonly onChange?: () => void;
  private headline?: string;
  private abc?: ThinkingAbcState;
  private parallelStarted = false;
  private winner: BranchKey | null = null;
  private closed = false;

  constructor(enabledBranches: readonly BranchKey[], onChange?: () => void) {
    this.enabledBranches = enabledBranches;
    this.onChange = onChange;
  }

  createBranchView<K extends BranchKey>(key: K): ThinkingBranchView<K> {
    const write = (operation: () => void) => {
      if (!this.closed && this.enabledBranches.includes(key)) operation();
    };

    return {
      key,
      ensureParallelStarted: () => write(() => this.ensureParallelStarted()),
      set: (status, label) => write(() => this.setBranch(key, status, label)),
      setContent: (content) => write(() => this.setBranchContent(key, content)),
      setCards: (cards) => write(() => this.setBranchCards(key, cards)),
      log: (message) => write(() => this.log(key, message)),
    };
  }

  setAbcState(state?: ThinkingAbcState) {
    if (this.closed || !state || !this.enabledBranches.includes("abc")) return;
    this.abc = state;
    this.flush();
  }

  finish(winner?: BranchKey) {
    if (this.closed) return;
    this.winner = winner ?? null;
    for (const branch of this.enabledBranches) {
      if (branch !== winner && this.branches[branch].status === "running") {
        this.branches[branch].status = "cancelled";
        this.branches[branch].label = t("query.status.cancelled");
      }
    }
    if (
      winner !== "abc" &&
      this.abc &&
      (this.abc.status === "idle" || this.abc.status === "running")
    ) {
      this.abc = {
        ...this.abc,
        status: "cancelled",
        steps: this.abc.steps.map((step) => ({
          ...step,
          active: false,
          status:
            step.status === "running" || step.status === "waiting" ? "cancelled" : step.status,
        })),
      };
    }
    this.closed = true;
    this.flush();
  }

  snapshot(): QueryThinkingState {
    const labels: Record<BranchKey, string> = {
      static: t("query.branch.static"),
      hot: t("query.branch.hot"),
      abc: t("query.branch.abc"),
    };

    const branches: ThinkingBranchState[] = this.enabledBranches.map((key) => {
      const branch = this.branches[key];
      return {
        key,
        label: labels[key],
        status: branch.status,
        detail: branch.label || undefined,
        logs: branch.logs.slice(-2),
        winner: this.winner === key,
        content: branch.content,
        cards: branch.cards,
      };
    });

    return {
      summary: "",
      headline: this.headline,
      status: this.winner ? "completed" : this.closed ? "failed" : "running",
      winner: this.winner,
      branches,
      abc: this.abc,
    };
  }

  private ensureParallelStarted() {
    if (this.startParallel()) this.flush();
  }

  private startParallel() {
    if (this.parallelStarted) return false;
    this.parallelStarted = true;
    this.headline = t("query.thinking.parallelStart");
    return true;
  }

  private setBranch(key: BranchKey, status: ThinkingBranchStatus, label: string) {
    this.startParallel();
    this.branches[key].status = status;
    this.branches[key].label = label;
    this.flush();
  }

  private setBranchContent(key: BranchKey, content: string) {
    this.branches[key].content = content;
    this.flush();
  }

  private setBranchCards(key: BranchKey, cards: ThinkingBranchCard[]) {
    this.branches[key].cards = cards;
    this.flush();
  }

  private log(key: BranchKey, message: string) {
    this.startParallel();
    const branch = this.branches[key];
    branch.logs.push(message);
    if (branch.logs.length > MAX_LINES_PER_BRANCH) {
      branch.logs = branch.logs.slice(-MAX_LINES_PER_BRANCH);
    }
    this.flush();
  }

  private flush() {
    this.onChange?.();
  }
}
