/**
 * Concurrency pool utility
 * Limits the number of Promises executing concurrently
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
  /** Dimension query concurrency, default 6 */
  dimensionQueryConcurrency?: number;
  /** Sub-question query concurrency, default 4 */
  subQuestionQueryConcurrency?: number;
  /** Chart generation concurrency, default 3 */
  chartGenerationConcurrency?: number;
  /** Sub-question query interval (ms), default 2000ms */
  subQuestionQueryIntervalMs?: number;
  /** Report generation cooldown interval (ms): the wait between two adjacent LLM calls when reports are generated serially, default 2000ms */
  reportGenerationCooldownMs?: number;
}

export const DEFAULT_ANALYSIS_CONCURRENCY: AnalysisConcurrencyConfig = {
  dimensionQueryConcurrency: 6,
  subQuestionQueryConcurrency: 4,
  chartGenerationConcurrency: 3,
  subQuestionQueryIntervalMs: 2000,
  reportGenerationCooldownMs: 2000,
};
