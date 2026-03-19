// CLI 命令共享工具函数

import { join } from 'node:path';
import { LanceDBStore, DashScopeEmbeddingProvider } from '@lisan/rag';
import type { EmbeddingProvider } from '@lisan/rag';
import type { LisanConfig } from '../config.js';

/** 创建 embedding provider */
export function createEmbeddingProvider(config: LisanConfig): EmbeddingProvider {
  return new DashScopeEmbeddingProvider({
    apiKey: config.rag.embedApiKey || undefined,
    model: config.rag.embedModel,
    baseUrl: config.rag.embedBaseUrl || undefined,
  });
}

/** 创建并初始化 vector store，失败返回 null */
export async function createVectorStore(
  projectRoot: string,
  config: LisanConfig,
): Promise<LanceDBStore | null> {
  try {
    const embeddingProvider = createEmbeddingProvider(config);
    const store = new LanceDBStore({
      dbPath: join(projectRoot, '.lisan', 'vectors'),
      embeddingProvider,
    });
    await store.init();
    return store;
  } catch {
    return null;
  }
}
