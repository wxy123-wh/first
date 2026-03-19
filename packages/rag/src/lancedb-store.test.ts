// LanceDBStore upsert + search 单元测试

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LanceDBStore } from './lancedb-store.js';
import type { Document, EmbeddingProvider } from './types.js';

/** 简单的 mock embedding：将文本长度映射为固定维度向量 */
function createMockEmbeddingProvider(dims = 8): EmbeddingProvider {
  return {
    dimensions: dims,
    async embed(texts: string[]): Promise<number[][]> {
      return texts.map((text) => {
        // 基于文本内容生成确定性向量
        const vec = new Array(dims).fill(0);
        for (let i = 0; i < text.length; i++) {
          vec[i % dims] += text.charCodeAt(i) / 1000;
        }
        // 归一化
        const norm = Math.sqrt(vec.reduce((s: number, v: number) => s + v * v, 0));
        return norm > 0 ? vec.map((v: number) => v / norm) : vec;
      });
    },
  };
}

function createDoc(id: string, content: string, type: Document['metadata']['type'] = 'chapter'): Document {
  return {
    id,
    content,
    metadata: {
      source: `${id}.md`,
      type,
      tags: ['test'],
    },
  };
}

describe('LanceDBStore', () => {
  let tempDir: string;
  let store: LanceDBStore;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'lisan-rag-test-'));
    store = new LanceDBStore({
      dbPath: join(tempDir, 'test.lance'),
      embeddingProvider: createMockEmbeddingProvider(),
    });
    await store.init();
  });

  afterEach(async () => {
    store.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  it('upsert + getById', async () => {
    const doc = createDoc('doc-1', '林逸站在天台上，风吹过他的衣角');
    await store.upsert([doc]);

    const found = await store.getById('doc-1');
    expect(found).not.toBeNull();
    expect(found!.id).toBe('doc-1');
    expect(found!.content).toBe('林逸站在天台上，风吹过他的衣角');
    expect(found!.metadata.type).toBe('chapter');
  });

  it('upsert 覆盖已有文档', async () => {
    await store.upsert([createDoc('doc-1', '原始内容')]);
    await store.upsert([createDoc('doc-1', '更新后的内容')]);

    const found = await store.getById('doc-1');
    expect(found!.content).toBe('更新后的内容');
  });

  it('批量 upsert', async () => {
    const docs = [
      createDoc('doc-1', '第一章内容'),
      createDoc('doc-2', '第二章内容'),
      createDoc('doc-3', '第三章内容'),
    ];
    await store.upsert(docs);

    expect(await store.getById('doc-1')).not.toBeNull();
    expect(await store.getById('doc-2')).not.toBeNull();
    expect(await store.getById('doc-3')).not.toBeNull();
  });

  it('向量检索返回结果', async () => {
    await store.upsert([
      createDoc('doc-1', '林逸在天台上练剑'),
      createDoc('doc-2', '城市的夜景灯火通明'),
      createDoc('doc-3', '林逸挥剑斩向敌人'),
    ]);

    const results = await store.search({
      text: '林逸练剑',
      topK: 2,
      mode: 'vector',
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThanOrEqual(2);
    expect(results[0].document).toBeDefined();
    expect(results[0].score).toBeDefined();
  });

  it('按 type 过滤', async () => {
    await store.upsert([
      createDoc('ch-1', '章节内容', 'chapter'),
      createDoc('set-1', '设定内容', 'setting'),
      createDoc('out-1', '大纲内容', 'outline'),
    ]);

    const results = await store.search({
      text: '内容',
      topK: 10,
      mode: 'vector',
      filter: { type: ['setting'] },
    });

    // 所有结果都应该是 setting 类型
    for (const r of results) {
      expect(r.document.metadata.type).toBe('setting');
    }
  });

  it('delete 删除文档', async () => {
    await store.upsert([createDoc('doc-1', '待删除')]);
    expect(await store.getById('doc-1')).not.toBeNull();

    await store.delete(['doc-1']);
    expect(await store.getById('doc-1')).toBeNull();
  });

  it('空 upsert 不报错', async () => {
    await expect(store.upsert([])).resolves.not.toThrow();
  });

  it('getById 不存在返回 null', async () => {
    await store.upsert([createDoc('doc-1', '存在的文档')]);
    expect(await store.getById('nonexistent')).toBeNull();
  });
});
