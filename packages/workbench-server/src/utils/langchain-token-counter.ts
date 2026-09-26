const approximateTokenCounterMarker = Symbol("approximateTokenCounter");

type TokenCountingModel = {
  [approximateTokenCounterMarker]?: boolean;
  getNumTokens: (content: unknown) => Promise<number>;
  getNumTokensFromMessages?: (
    messages: unknown[]
  ) => Promise<{ totalCount: number; countPerMessage: number[] }>;
  _getEstimatedTokenCountFromPrompt?: (
    messages: unknown[],
    functions?: unknown,
    functionCall?: unknown
  ) => Promise<number>;
  _getNumTokensFromGenerations?: (generations: unknown[]) => Promise<number>;
  bindTools?: (...args: unknown[]) => unknown;
};

function textFromContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content.map(textFromContent).join("");
  }

  if (content && typeof content === "object") {
    const value = content as { content?: unknown; text?: unknown };
    if (typeof value.text === "string") {
      return value.text;
    }
    if (value.content !== undefined) {
      return textFromContent(value.content);
    }
  }

  return "";
}

export function estimateTokenCount(content: unknown): number {
  return Math.ceil(textFromContent(content).length / 4);
}

function messageContent(message: unknown): unknown {
  if (message && typeof message === "object" && "content" in message) {
    return (message as { content?: unknown }).content;
  }
  return message;
}

function messageRole(message: unknown): string {
  if (!message || typeof message !== "object") {
    return "";
  }

  const value = message as {
    role?: unknown;
    getType?: unknown;
    _getType?: unknown;
  };

  if (typeof value.role === "string") {
    return value.role;
  }
  if (typeof value.getType === "function") {
    return value.getType();
  }
  if (typeof value._getType === "function") {
    return value._getType();
  }
  return "";
}

function messageName(message: unknown): unknown {
  if (message && typeof message === "object" && "name" in message) {
    return (message as { name?: unknown }).name;
  }
  return "";
}

export function estimateMessageTokenCounts(messages: unknown[]): {
  totalCount: number;
  countPerMessage: number[];
} {
  const countPerMessage = messages.map((message) => {
    return (
      estimateTokenCount(messageContent(message)) +
      estimateTokenCount(messageRole(message)) +
      estimateTokenCount(messageName(message)) +
      3
    );
  });

  return {
    totalCount: countPerMessage.reduce((sum, count) => sum + count, 3),
    countPerMessage,
  };
}

export function useApproximateTokenCounter<T extends object>(model: T): T {
  const tokenModel = model as T & TokenCountingModel;

  if (tokenModel[approximateTokenCounterMarker]) {
    return model;
  }

  Object.defineProperty(tokenModel, approximateTokenCounterMarker, {
    value: true,
    configurable: true,
  });

  tokenModel.getNumTokens = async (content: unknown) => estimateTokenCount(content);
  tokenModel.getNumTokensFromMessages = async (messages: unknown[]) =>
    estimateMessageTokenCounts(messages);
  tokenModel._getEstimatedTokenCountFromPrompt = async (
    messages: unknown[],
    functions?: unknown,
    functionCall?: unknown
  ) => {
    let tokens = estimateMessageTokenCounts(messages).totalCount;
    if (functions) {
      tokens += estimateTokenCount(JSON.stringify(functions)) + 9;
    }
    if (functionCall && typeof functionCall === "object" && "name" in functionCall) {
      tokens += estimateTokenCount((functionCall as { name?: unknown }).name) + 4;
    }
    return tokens;
  };
  tokenModel._getNumTokensFromGenerations = async (generations: unknown[]) => {
    return generations.reduce<number>((sum, generation) => {
      const message =
        generation && typeof generation === "object" && "message" in generation
          ? (generation as { message?: unknown }).message
          : generation;
      return sum + estimateTokenCount(messageContent(message));
    }, 0);
  };

  const bindTools = tokenModel.bindTools;
  if (typeof bindTools === "function") {
    tokenModel.bindTools = function wrappedBindTools(this: unknown, ...args: unknown[]) {
      const result = bindTools.apply(this, args);
      return result && typeof result === "object" ? useApproximateTokenCounter(result) : result;
    };
  }

  return model;
}
