// LLM 重试 + 超时 单元测试

import { describe, it, expect, vi } from 'vitest';
import { withRetry } from './retry.js';

describe('withRetry', () => {
  it('成功时直接返回结果', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await withRetry(fn);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('遇到 429 限流错误时重试', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('429 Too Many Requests'))
      .mockRejectedValueOnce(new Error('rate limit exceeded'))
      .mockResolvedValue('ok');

    const result = await withRetry(fn);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('遇到 5xx 服务端错误时重试', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('502 Bad Gateway'))
      .mockResolvedValue('ok');

    const result = await withRetry(fn);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('非可重试错误直接抛出', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('400 Bad Request'));
    await expect(withRetry(fn)).rejects.toThrow('400 Bad Request');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('超过最大重试次数后抛出', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('503 Service Unavailable'));
    await expect(withRetry(fn)).rejects.toThrow('503 Service Unavailable');
    expect(fn).toHaveBeenCalledTimes(4); // 1 初始 + 3 重试
  }, 30_000);
});
