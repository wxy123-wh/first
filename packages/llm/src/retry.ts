// 指数退避重试封装

import pRetry from 'p-retry';

/** 可重试的错误判断 */
function isRetryableError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    // 429 限流 或 5xx 服务端错误
    if (msg.includes('429') || msg.includes('rate limit')) return true;
    if (msg.includes('500') || msg.includes('502') || msg.includes('503') || msg.includes('504')) return true;
    if (msg.includes('server error') || msg.includes('internal error')) return true;
  }
  return false;
}

/**
 * 带指数退避的重试包装
 * 最多重试 3 次，仅对限流和服务端错误重试
 */
export async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  return pRetry(fn, {
    retries: 3,
    minTimeout: 1000,
    maxTimeout: 10_000,
    factor: 2,
    shouldRetry: isRetryableError,
  });
}
