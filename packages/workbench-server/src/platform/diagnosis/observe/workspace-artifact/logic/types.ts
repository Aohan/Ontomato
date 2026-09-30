export interface LogicItem {
  problem?: string;
  mqls?: string | string[];
  status?: "success" | "error";
  error?: string;
  sessionId?: string;
  m3Data?: string;
  finalCalculation?: string;
}

export interface LogicExtractionResult {
  items: LogicItem[];
  markdown: string;
}
