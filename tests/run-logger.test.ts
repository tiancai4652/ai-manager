import { describe, it, expect } from 'vitest';
import { RunLogger } from '../src/utils/run-logger.js';
import type { LLMCallRecord } from '../src/models/llm-call-record.js';

const makeCall = (overrides: Partial<LLMCallRecord> = {}): LLMCallRecord => ({
  timestamp: new Date().toISOString(),
  type: 'chat',
  purpose: '测试',
  model: 'test-model',
  mode: 'api',
  durationMs: 100,
  inputChars: 500,
  outputChars: 200,
  estimatedTokens: 200,
  success: true,
  ...overrides,
});

describe('RunLogger', () => {
  it('累积调用记录并返回统计', () => {
    const logger = new RunLogger('/tmp/test');
    logger.record(makeCall({ estimatedTokens: 100 }));
    logger.record(makeCall({ estimatedTokens: 200 }));

    const stats = logger.getStats();
    expect(stats.totalCalls).toBe(2);
    expect(stats.totalTokens).toBe(300);
  });

  it('getRecent 返回最近 N 条', () => {
    const logger = new RunLogger('/tmp/test');
    logger.record(makeCall({ purpose: 'a' }));
    logger.record(makeCall({ purpose: 'b' }));
    logger.record(makeCall({ purpose: 'c' }));

    const recent = logger.getRecent(2);
    expect(recent).toHaveLength(2);
    expect(recent[0].purpose).toBe('b');
    expect(recent[1].purpose).toBe('c');
  });

  it('无记录时统计为零', () => {
    const logger = new RunLogger('/tmp/test');
    const stats = logger.getStats();
    expect(stats.totalCalls).toBe(0);
    expect(stats.totalTokens).toBe(0);
  });
});
