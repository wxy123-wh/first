// @lisan/rag — 向量数据库封装

export type {
  Document,
  DocumentType,
  SearchQuery,
  SearchResult,
  VectorStore,
  EmbeddingProvider,
} from './types.js';

export { LanceDBStore } from './lancedb-store.js';
export type { LanceDBStoreConfig } from './lancedb-store.js';
export { DashScopeEmbeddingProvider } from './dashscope-embedding.js';
export type { DashScopeEmbeddingConfig } from './dashscope-embedding.js';
export { readL0, readL1, readL2 } from './layers.js';
export {
  DEFAULT_SYNC_DIRS,
  scanMarkdownFiles,
  inferDocumentType,
  collectSyncMarkdownFiles,
} from './sync-utils.js';
