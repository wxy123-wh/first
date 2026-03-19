// @lisan/rag — 向量数据库接口定义

/** 文档类型 */
export type DocumentType = 'setting' | 'chapter' | 'scene' | 'outline' | 'reference';

/** 文档 */
export interface Document {
  id: string;
  content: string;
  metadata: {
    source: string;
    type: DocumentType;
    tags?: string[];
    /** L0：一句话摘要（~200字） */
    abstract?: string;
    /** L1：结构化概览（~1-2KB） */
    overview?: string;
  };
}

/** 检索查询 */
export interface SearchQuery {
  text: string;
  topK?: number;
  filter?: {
    type?: DocumentType[];
    tags?: string[];
  };
  mode?: 'vector' | 'bm25' | 'hybrid';
}

/** 检索结果 */
export interface SearchResult {
  document: Document;
  score: number;
}

/** 向量数据库接口 */
export interface VectorStore {
  upsert(docs: Document[]): Promise<void>;
  search(query: SearchQuery): Promise<SearchResult[]>;
  delete(ids: string[]): Promise<void>;
  getById(id: string): Promise<Document | null>;
}

/** Embedding 提供者接口 */
export interface EmbeddingProvider {
  embed(texts: string[]): Promise<number[][]>;
  readonly dimensions: number;
}
