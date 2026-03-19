// 三层渐进式读取辅助函数

import type { Document, VectorStore } from './types.js';

/**
 * L0 读取：获取文档的一句话摘要（~200字）
 * 用于快速判断是否需要进一步读取
 */
export async function readL0(store: VectorStore, id: string): Promise<string | null> {
  const doc = await store.getById(id);
  return doc?.metadata.abstract ?? null;
}

/**
 * L1 读取：获取文档的结构化概览（~1-2KB）
 * 用于了解大意和结构
 */
export async function readL1(store: VectorStore, id: string): Promise<string | null> {
  const doc = await store.getById(id);
  return doc?.metadata.overview ?? null;
}

/**
 * L2 读取：获取文档完整内容
 * 确认需要后才读取
 */
export async function readL2(store: VectorStore, id: string): Promise<Document | null> {
  return store.getById(id);
}
