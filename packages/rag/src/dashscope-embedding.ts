// DashScope Embedding Provider — 阿里云 text-embedding-v3 对接

import type { EmbeddingProvider } from './types.js';

export interface DashScopeEmbeddingConfig {
  /** API Key，默认读取 DASHSCOPE_API_KEY 环境变量 */
  apiKey?: string;
  /** 模型名称，默认 text-embedding-v3 */
  model?: string;
  /** API 基础 URL */
  baseUrl?: string;
  /** 向量维度，默认 1024 */
  dimensions?: number;
}

interface DashScopeEmbeddingResponse {
  output: {
    embeddings: Array<{
      text_index: number;
      embedding: number[];
    }>;
  };
  usage: {
    total_tokens: number;
  };
}

/**
 * DashScope text-embedding-v3 实现
 * 文档: https://help.aliyun.com/zh/model-studio/text-embedding
 */
export class DashScopeEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions: number;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;

  constructor(config: DashScopeEmbeddingConfig = {}) {
    this.apiKey = config.apiKey ?? process.env['DASHSCOPE_API_KEY'] ?? '';
    this.model = config.model ?? 'text-embedding-v3';
    this.baseUrl = config.baseUrl ?? 'https://dashscope.aliyuncs.com/api/v1/services/embeddings/text-embedding/text-embedding';
    this.dimensions = config.dimensions ?? 1024;

    if (!this.apiKey) {
      throw new Error('DashScope API Key 未配置，请设置 DASHSCOPE_API_KEY 环境变量或传入 apiKey');
    }
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    // DashScope 单次最多 25 条，分批处理
    const batchSize = 25;
    const allEmbeddings: number[][] = new Array(texts.length);

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const embeddings = await this.callApi(batch);

      for (let j = 0; j < embeddings.length; j++) {
        allEmbeddings[i + j] = embeddings[j];
      }
    }

    return allEmbeddings;
  }

  private async callApi(texts: string[]): Promise<number[][]> {
    const body = {
      model: this.model,
      input: { texts },
      parameters: {
        dimension: this.dimensions,
      },
    };

    const response = await fetch(this.baseUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`DashScope embedding 请求失败 (${response.status}): ${errorText}`);
    }

    const data = (await response.json()) as DashScopeEmbeddingResponse;
    // 按 text_index 排序确保顺序正确
    const sorted = [...data.output.embeddings].sort((a, b) => a.text_index - b.text_index);
    return sorted.map((e) => e.embedding);
  }
}
