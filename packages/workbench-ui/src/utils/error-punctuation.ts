/** 请求错误详情的拼接标点：两版原值不同（企业全角“：”“；”，开源半角），由应用静态提供，不随界面语言变化。 */
export interface ErrorPunctuation {
  /** 主消息与字段详情之间。 */
  detailSeparator: string;
  /** 多条字段详情之间。 */
  listSeparator: string;
}

let punctuation: ErrorPunctuation | null = null;

export function installErrorPunctuation(next: ErrorPunctuation): void {
  punctuation = next;
}

export function errorPunctuation(): ErrorPunctuation {
  if (!punctuation) throw new Error("Workbench error punctuation is not installed");
  return punctuation;
}
