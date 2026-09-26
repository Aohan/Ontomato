/**
 * 并发池工具
 * 用于限制 Promise 并发执行数量
 */

export async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  concurrencyLimit: number
): Promise<T[]> {
  if (tasks.length === 0) {
    return [];
  }

  const results: T[] = [];
  let currentIndex = 0;

  async function worker() {
    while (currentIndex < tasks.length) {
      const index = currentIndex++;
      const task = tasks[index];
      try {
        const result = await task();
        results[index] = result;
      } catch (error) {
        results[index] = error as T;
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrencyLimit, tasks.length) }, () => worker());
  await Promise.all(workers);

  return results;
}

export function createConcurrencyPool(concurrencyLimit: number) {
  return {
    limit: concurrencyLimit,
    run: <T>(tasks: Array<() => Promise<T>>): Promise<T[]> =>
      runWithConcurrency(tasks, concurrencyLimit),
  };
}

export async function runSequentialWithDelay<T>(
  tasks: Array<() => Promise<T>>,
  delayMs: number
): Promise<T[]> {
  if (tasks.length === 0) return [];

  const results: T[] = [];
  for (let i = 0; i < tasks.length; i++) {
    if (i > 0 && delayMs > 0) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
    try {
      results[i] = await tasks[i]();
    } catch (error) {
      results[i] = error as T;
    }
  }
  return results;
}

export interface AnalysisConcurrencyConfig {
  /** 维度查询并发数，默认 6 */
  dimensionQueryConcurrency?: number;
  /** 子问题查询并发数，默认 4 */
  subQuestionQueryConcurrency?: number;
  /** 图表生成并发数，默认 3 */
  chartGenerationConcurrency?: number;
  /** 子问题查询间隔（毫秒），默认 2000ms */
  subQuestionQueryIntervalMs?: number;
  /** 报告生成冷却间隔（毫秒），串行生成报告时相邻两次 LLM 调用之间的等待时间，默认 2000ms */
  reportGenerationCooldownMs?: number;
}

export const DEFAULT_ANALYSIS_CONCURRENCY: AnalysisConcurrencyConfig = {
  dimensionQueryConcurrency: 6,
  subQuestionQueryConcurrency: 4,
  chartGenerationConcurrency: 3,
  subQuestionQueryIntervalMs: 2000,
  reportGenerationCooldownMs: 2000,
};
