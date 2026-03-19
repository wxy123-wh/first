// LanceDB 向量数据库实现

import { connect, type Connection, type Table } from '@lancedb/lancedb';
import type {
  Document,
  SearchQuery,
  SearchResult,
  VectorStore,
  EmbeddingProvider,
} from './types.js';

export interface LanceDBStoreConfig {
  /** 数据库存储路径 */
  dbPath: string;
  /** Embedding 提供者 */
  embeddingProvider: EmbeddingProvider;
  /** 表名，默认 'documents' */
  tableName?: string;
}

/** LanceDB 内部行结构 */
type LanceRow = Record<string, unknown> & {
  id: string;
  content: string;
  source: string;
  type: string;
  tags: string;
  abstract: string;
  overview: string;
  vector: number[];
};

/**
 * LanceDB 向量数据库封装
 * 支持向量检索 + FTS 全文搜索
 */
export class LanceDBStore implements VectorStore {
  private readonly config: Required<LanceDBStoreConfig>;
  private db: Connection | null = null;
  private table: Table | null = null;

  constructor(config: LanceDBStoreConfig) {
    this.config = {
      ...config,
      tableName: config.tableName ?? 'documents',
    };
  }

  /** 初始化数据库连接 */
  async init(): Promise<void> {
    this.db = await connect(this.config.dbPath);
    const tableNames = await this.db.tableNames();
    if (tableNames.includes(this.config.tableName)) {
      this.table = await this.db.openTable(this.config.tableName);
    }
  }

  private async ensureTable(): Promise<Table> {
    if (!this.db) throw new Error('LanceDBStore 未初始化，请先调用 init()');
    if (this.table) return this.table;
    // 表不存在时，在第一次 upsert 时创建
    throw new Error(`表 ${this.config.tableName} 不存在，请先 upsert 数据`);
  }

  private docToRow(doc: Document, vector: number[]): LanceRow {
    return {
      id: doc.id,
      content: doc.content,
      source: doc.metadata.source,
      type: doc.metadata.type,
      tags: JSON.stringify(doc.metadata.tags ?? []),
      abstract: doc.metadata.abstract ?? '',
      overview: doc.metadata.overview ?? '',
      vector,
    };
  }

  private rowToDoc(row: Record<string, unknown>): Document {
    return {
      id: row['id'] as string,
      content: row['content'] as string,
      metadata: {
        source: row['source'] as string,
        type: row['type'] as Document['metadata']['type'],
        tags: JSON.parse((row['tags'] as string) || '[]') as string[],
        abstract: (row['abstract'] as string) || undefined,
        overview: (row['overview'] as string) || undefined,
      },
    };
  }

  async upsert(docs: Document[]): Promise<void> {
    if (!this.db) throw new Error('LanceDBStore 未初始化，请先调用 init()');
    if (docs.length === 0) return;

    // 批量生成 embedding
    const texts = docs.map((d) => d.content);
    const embeddings = await this.config.embeddingProvider.embed(texts);

    const rows = docs.map((doc, i) => this.docToRow(doc, embeddings[i]));

    if (!this.table) {
      // 首次写入，创建表
      this.table = await this.db.createTable(this.config.tableName, rows);
    } else {
      // 已有表：先删除同 id 的旧数据，再追加
      const ids = docs.map((d) => d.id);
      const idList = ids.map((id) => `'${id}'`).join(',');
      try {
        await this.table.delete(`id IN (${idList})`);
      } catch {
        // 如果表为空或 id 不存在，忽略删除错误
      }
      await this.table.add(rows);
    }
  }

  async search(query: SearchQuery): Promise<SearchResult[]> {
    const table = await this.ensureTable();
    const topK = query.topK ?? 10;
    const mode = query.mode ?? 'hybrid';

    // 构建过滤条件
    let filterExpr: string | undefined;
    if (query.filter?.type && query.filter.type.length > 0) {
      const types = query.filter.type.map((t) => `'${t}'`).join(',');
      filterExpr = `type IN (${types})`;
    }

    if (mode === 'vector' || mode === 'hybrid') {
      // 向量检索
      const queryEmbedding = await this.config.embeddingProvider.embed([query.text]);
      const vectorQuery = table.vectorSearch(queryEmbedding[0]);

      if (filterExpr) {
        vectorQuery.where(filterExpr);
      }
      vectorQuery.limit(topK);

      const results = await vectorQuery.toArray();
      return results.map((row: Record<string, unknown>) => ({
        document: this.rowToDoc(row),
        score: 1 - ((row['_distance'] as number) ?? 0), // 距离转相似度
      }));
    }

    // BM25 / 全文搜索模式
    const ftsQuery = table.search(query.text, 'fts');
    if (filterExpr) {
      ftsQuery.where(filterExpr);
    }
    ftsQuery.limit(topK);

    const results = await ftsQuery.toArray();
    return results.map((row: Record<string, unknown>) => ({
      document: this.rowToDoc(row),
      score: (row['_score'] as number) ?? 0,
    }));
  }

  async delete(ids: string[]): Promise<void> {
    const table = await this.ensureTable();
    if (ids.length === 0) return;
    const idList = ids.map((id) => `'${id}'`).join(',');
    await table.delete(`id IN (${idList})`);
  }

  async getById(id: string): Promise<Document | null> {
    const table = await this.ensureTable();
    const results = await table.query().where(`id = '${id}'`).limit(1).toArray();
    if (results.length === 0) return null;
    return this.rowToDoc(results[0] as Record<string, unknown>);
  }

  /** 关闭数据库连接 */
  close(): void {
    if (this.table) {
      this.table.close();
      this.table = null;
    }
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}
