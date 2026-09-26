import type { FlatService, SystemStatus } from "./agent/tools/service-health-tool";
import type { DiagnosticEventRecord } from "./workspace-artifact/logic/diagnostic-events-parser";
import type { LogicItem } from "./workspace-artifact/logic/types";

/**
 * 已装配应用提供的 M3 查询逻辑。参数和返回值只用公共事件与逻辑项。
 * 开源装配 null 时，共享解析不调用这些方法。
 */
export interface M3QueryLogic {
  itemFromEvent(
    eventType: "m3.query.succeeded" | "m3.query.failed",
    event: DiagnosticEventRecord,
    payload: Record<string, unknown>
  ): LogicItem | null;
  recordMqls(record: Record<string, unknown>): string | string[] | undefined;
  appendItemMarkdown(lines: string[], item: LogicItem): void;
}

/**
 * 已装配应用提供的 M3 运维服务。
 * 共享报告仍做统计、状态文案和明细骨架；下列文字只在该 provider 产出的非关键服务上使用。
 */
export interface M3ServiceHealth {
  services(status: SystemStatus): FlatService[];
  summaryNote: string;
  /** 明细里，非关键且未运行的服务接在状态后的标记。关键服务的 ⚠️ 仍由共享渲染写。 */
  unusedDetailMark: string;
  /** provider 写入的 note 与前面的状态之间的分隔。 */
  noteSeparator: string;
  /** 没有关键服务故障时，未运行的非关键服务导语。 */
  unusedDownIntro(count: number): string;
  /** 已有关键服务故障时，未运行的非关键服务导语。 */
  unusedDownAlso(count: number): string;
  unusedDownItem(group: string, name: string, statusText: string): string;
}

/**
 * 诊断对 DataRAG 的 M3 数据平台的理解：M3 查询事件与 MQL、运维状态中的 M3 服务、MQL 查询语言。
 * 企业应用装配对象；开源应用装配 null（原本不解析这些内容）。
 * 这里只决定诊断输出，不代表 DataRAG 是否支持 M3。
 */
export interface M3DiagnosticSupport {
  queryLogic: M3QueryLogic;
  serviceHealth: M3ServiceHealth;
  /** 数据适配器为 m3 时提交的查询语言。 */
  queryLanguage: "MQL";
  /**
   * 企业在适配器为 m3 且参考文件存在时追加的编写提示。
   * 开源装配 null 时不会读取该文件。
   */
  mqlReference: {
    fileName: string;
    hint: (absolutePath: string) => string;
  };
}

let installed: M3DiagnosticSupport | null | undefined;

export function installM3DiagnosticSupport(support: M3DiagnosticSupport | null): void {
  installed = support;
}

export function m3DiagnosticSupport(): M3DiagnosticSupport | null {
  if (installed === undefined) throw new Error("M3 diagnostic support is not installed");
  return installed;
}
