// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
import { describe, it, expect } from 'vitest';
import { ParallelRunner, runParallel } from '../../../src/lib/parallel-runner.js';

describe('ParallelRunner', () => {
  it('should run all tasks and return results', async () => {
    const runner = new ParallelRunner({ concurrency: 3 });
    const tasks = [
      () => Promise.resolve('a'),
      () => Promise.resolve('b'),
      () => Promise.resolve('c'),
    ];

    const results = await runner.runAll(tasks);
    expect(results).toHaveLength(3);
    expect(results[0]!.status).toBe('fulfilled');
    expect(results[0]!.value).toBe('a');
    expect(results[1]!.value).toBe('b');
    expect(results[2]!.value).toBe('c');
  });

  it('should handle task failures without stopping others', async () => {
    const runner = new ParallelRunner({ concurrency: 2 });
    const tasks = [
      () => Promise.resolve('ok'),
      () => Promise.reject(new Error('fail')),
      () => Promise.resolve('also ok'),
    ];

    const results = await runner.runAll(tasks);
    expect(results).toHaveLength(3);
    expect(results[0]!.status).toBe('fulfilled');
    expect(results[0]!.value).toBe('ok');
    expect(results[1]!.status).toBe('rejected');
    expect(results[1]!.reason).toBeInstanceOf(Error);
    expect(results[1]!.reason!.message).toBe('fail');
    expect(results[2]!.status).toBe('fulfilled');
    expect(results[2]!.value).toBe('also ok');
  });

  it('should respect concurrency limit', async () => {
    let maxConcurrent = 0;
    let currentConcurrent = 0;

    const runner = new ParallelRunner({ concurrency: 2 });
    const tasks = Array.from({ length: 10 }, () => async () => {
      currentConcurrent++;
      maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
      await new Promise((r) => setTimeout(r, 10));
      currentConcurrent--;
      return 'done';
    });

    await runner.runAll(tasks);
    expect(maxConcurrent).toBeLessThanOrEqual(2);
  });

  it('should handle empty task list', async () => {
    const runner = new ParallelRunner({ concurrency: 3 });
    const results = await runner.runAll([]);
    expect(results).toHaveLength(0);
  });

  it('should handle single task', async () => {
    const runner = new ParallelRunner({ concurrency: 5 });
    const results = await runner.runAll([() => Promise.resolve(42)]);
    expect(results).toHaveLength(1);
    expect(results[0]!.value).toBe(42);
  });

  it('should handle non-Error rejections', async () => {
    const runner = new ParallelRunner({ concurrency: 1 });
    const tasks = [() => Promise.reject('string error')];

    const results = await runner.runAll(tasks);
    expect(results[0]!.status).toBe('rejected');
    expect(results[0]!.reason).toBeInstanceOf(Error);
    expect(results[0]!.reason!.message).toBe('string error');
  });
});

describe('runParallel helper', () => {
  it('should run tasks with default concurrency', async () => {
    const results = await runParallel([
      () => Promise.resolve(1),
      () => Promise.resolve(2),
      () => Promise.resolve(3),
    ]);

    expect(results).toHaveLength(3);
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
  });

  it('should accept custom concurrency', async () => {
    const results = await runParallel(
      [() => Promise.resolve('a')],
      1
    );
    expect(results).toHaveLength(1);
    expect(results[0]!.value).toBe('a');
  });
});
