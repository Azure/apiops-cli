/**
 * T018: Parallel execution runner with concurrency control.
 *
 * Custom implementation (no external dependencies such as p-limit) to limit
 * concurrent APIM REST API calls and avoid 429 rate limiting. Azure APIM has
 * strict per-second request limits, so unbounded Promise.all() would fire all
 * requests simultaneously, triggering throttling. Bounded concurrency is a
 * requirement from research.md R8 and justified in tasks.md T018.
 *
 * Built-in implementation without external dependencies (no p-limit).
 */

export interface ParallelRunnerOptions {
  concurrency: number;
}

export interface TaskResult<T> {
  status: 'fulfilled' | 'rejected';
  value?: T;
  reason?: Error;
}

/**
 * Executes tasks in parallel with bounded concurrency.
 * Uses Promise.allSettled for fault tolerance.
 */
export class ParallelRunner {
  private concurrency: number;

  constructor(options: ParallelRunnerOptions) {
    this.concurrency = options.concurrency;
  }

  /**
   * Run tasks in parallel with bounded concurrency.
   * Returns results for all tasks, including failures.
   */
  async runAll<T>(tasks: (() => Promise<T>)[]): Promise<TaskResult<T>[]> {
    const results: TaskResult<T>[] = [];
    const executing = new Map<number, Promise<void>>();
    const completed = new Set<number>();
    
    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];
      if (!task) continue;

      const promise = this.executeTask(task, i, results).then(() => {
        completed.add(i);
      });
      
      executing.set(i, promise);
      
      // When we hit concurrency limit, wait for one to finish
      if (executing.size >= this.concurrency) {
        await Promise.race(executing.values());
        // Remove completed promises
        for (const idx of completed) {
          executing.delete(idx);
        }
      }
    }
    
    // Wait for remaining tasks to complete
    await Promise.allSettled(executing.values());
    
    return results;
  }

  private async executeTask<T>(
    task: () => Promise<T>,
    index: number,
    results: TaskResult<T>[]
  ): Promise<void> {
    try {
      const value = await task();
      results[index] = { status: 'fulfilled', value };
    } catch (error) {
      results[index] = { 
        status: 'rejected', 
        reason: error instanceof Error ? error : new Error(String(error)) 
      };
    }
  }
}

/**
 * Helper function to run tasks with default concurrency.
 */
export async function runParallel<T>(
  tasks: (() => Promise<T>)[],
  concurrency = 5
): Promise<TaskResult<T>[]> {
  const runner = new ParallelRunner({ concurrency });
  return runner.runAll(tasks);
}
