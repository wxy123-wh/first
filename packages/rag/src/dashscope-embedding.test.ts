// DashScope Embedding Provider 单元测试

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DashScopeEmbeddingProvider } from './dashscope-embedding.js';

describe('DashScopeEmbeddingProvider', () => {
  const originalEnv = process.env['DASHSCOPE_API_KEY'];

  beforeEach(() => {
    process.env['DASHSCOPE_API_KEY'] = 'test-api-key';
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env['DASHSCOPE_API_KEY'] = originalEnv;
    } else {
      delete process.env['DASHSCOPE_API_KEY'];
    }
    vi.restoreAllMocks();
  });

  it('缺少 API Key 时抛出错误', () => {
    delete process.env['DASHSCOPE_API_KEY'];
    expect(() => new DashScopeEmbeddingProvider({ apiKey: '' })).toThrow('API Key');
  });

  it('默认维度为 1024', () => {
    const provider = new DashScopeEmbeddingProvider();
    expect(provider.dimensions).toBe(1024);
  });

  it('自定义维度', () => {
    const provider = new DashScopeEmbeddingProvider({ dimensions: 768 });
    expect(provider.dimensions).toBe(768);
  });

  it('空数组直接返回', async () => {
    const provider = new DashScopeEmbeddingProvider();
    const result = await provider.embed([]);
    expect(result).toEqual([]);
  });

  it('成功调用 API 并返回 embedding', async () => {
    const mockEmbedding = [0.1, 0.2, 0.3];
    const mockResponse = {
      output: {
        embeddings: [
          { text_index: 0, embedding: mockEmbedding },
        ],
      },
      usage: { total_tokens: 10 },
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    } as Response);

    const provider = new DashScopeEmbeddingProvider();
    const result = await provider.embed(['测试文本']);

    expect(result).toEqual([mockEmbedding]);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('多条文本按 text_index 排序', async () => {
    const mockResponse = {
      output: {
        embeddings: [
          { text_index: 1, embedding: [0.4, 0.5] },
          { text_index: 0, embedding: [0.1, 0.2] },
        ],
      },
      usage: { total_tokens: 20 },
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    } as Response);

    const provider = new DashScopeEmbeddingProvider();
    const result = await provider.embed(['文本1', '文本2']);

    expect(result[0]).toEqual([0.1, 0.2]);
    expect(result[1]).toEqual([0.4, 0.5]);
  });

  it('超过 25 条时分批调用', async () => {
    const texts = Array.from({ length: 30 }, (_, i) => `文本${i}`);

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const body = JSON.parse((init as RequestInit).body as string);
      const inputTexts = body.input.texts as string[];
      return {
        ok: true,
        json: () => Promise.resolve({
          output: {
            embeddings: inputTexts.map((_: string, i: number) => ({
              text_index: i,
              embedding: [i * 0.1],
            })),
          },
          usage: { total_tokens: inputTexts.length },
        }),
      } as Response;
    });

    const provider = new DashScopeEmbeddingProvider();
    const result = await provider.embed(texts);

    expect(result).toHaveLength(30);
    // 应该调用 2 次（25 + 5）
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('API 返回错误时抛出异常', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve('Unauthorized'),
    } as Response);

    const provider = new DashScopeEmbeddingProvider();
    await expect(provider.embed(['测试'])).rejects.toThrow('401');
  });
});
