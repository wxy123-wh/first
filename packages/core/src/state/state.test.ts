// FileStateManager + SqliteEntityGraph 单元测试

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileStateManager, registerMigration } from './file-state-manager.js';
import { SqliteEntityGraph } from './entity-graph.js';
import type { Entity } from './entity-graph.js';

describe('FileStateManager', () => {
  let tempDir: string;
  let manager: FileStateManager;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'lisan-test-'));
    manager = new FileStateManager(tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('首次 load 返回默认状态', async () => {
    const state = await manager.load();
    expect(state.version).toBe('1');
    expect(state.bookId).toBe('');
    expect(state.currentChapter).toBe(0);
    expect(state.chapters).toEqual({});
  });

  it('save 后 load 能读回', async () => {
    const state = await manager.load();
    state.bookId = 'test-book';
    state.currentChapter = 5;
    await manager.save(state);

    const loaded = await manager.load();
    expect(loaded.bookId).toBe('test-book');
    expect(loaded.currentChapter).toBe(5);
    expect(loaded.lastUpdated).toBeTruthy();
  });

  it('updateChapter 原子更新', async () => {
    await manager.updateChapter(1, {
      title: '第一章',
      status: 'drafting',
      filePath: '/ch01.md',
    });

    const state = await manager.load();
    expect(state.chapters[1]).toBeDefined();
    expect(state.chapters[1].title).toBe('第一章');
    expect(state.chapters[1].status).toBe('drafting');

    // 部分更新
    await manager.updateChapter(1, { status: 'done', wordCount: 3000 });
    const updated = await manager.load();
    expect(updated.chapters[1].title).toBe('第一章');
    expect(updated.chapters[1].status).toBe('done');
    expect(updated.chapters[1].wordCount).toBe(3000);
  });

  it('schema 迁移：旧版本自动迁移到当前版本', async () => {
    // 注册 0 → 1 迁移
    registerMigration('0', '1', (state) => {
      return {
        ...state,
        version: '1',
        currentArc: (state['currentArc'] as string) ?? 'default-arc',
      };
    });

    // 手写一个 version=0 的旧状态文件
    const { mkdir, writeFile } = await import('node:fs/promises');
    const { dirname } = await import('node:path');
    const statePath = join(tempDir, '.lisan', 'state.json');
    await mkdir(dirname(statePath), { recursive: true });
    await writeFile(statePath, JSON.stringify({
      version: '0',
      bookId: 'old-book',
      currentChapter: 3,
      chapters: {},
      lastUpdated: '2025-01-01',
    }), 'utf-8');

    const state = await manager.load();
    expect(state.version).toBe('1');
    expect(state.bookId).toBe('old-book');
    expect(state.currentArc).toBe('default-arc');
  });

  it('schema 迁移：无注册迁移路径时强制设为当前版本', async () => {
    const { mkdir, writeFile } = await import('node:fs/promises');
    const { dirname } = await import('node:path');
    const statePath = join(tempDir, '.lisan', 'state.json');
    await mkdir(dirname(statePath), { recursive: true });
    await writeFile(statePath, JSON.stringify({
      version: '999',
      bookId: 'future-book',
      currentChapter: 1,
      currentArc: '',
      chapters: {},
      lastUpdated: '2025-01-01',
    }), 'utf-8');

    const state = await manager.load();
    expect(state.version).toBe('1');
    expect(state.bookId).toBe('future-book');
  });
});

describe('SqliteEntityGraph', () => {
  let tempDir: string;
  let graph: SqliteEntityGraph;

  const testEntity: Entity = {
    id: 'char-001',
    name: '林逸',
    type: 'character',
    metadata: { role: 'protagonist', age: 25 },
    createdInChapter: 1,
    arcId: 'arc-1',
    persistence: 'permanent',
    needsReview: false,
  };

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'lisan-test-'));
    graph = new SqliteEntityGraph(join(tempDir, 'entities.db'));
  });

  afterEach(async () => {
    graph.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  it('create + getById', () => {
    graph.create(testEntity);
    const found = graph.getById('char-001');
    expect(found).not.toBeNull();
    expect(found!.name).toBe('林逸');
    expect(found!.type).toBe('character');
    expect(found!.metadata).toEqual({ role: 'protagonist', age: 25 });
    expect(found!.persistence).toBe('permanent');
    expect(found!.needsReview).toBe(false);
  });

  it('getById 不存在返回 null', () => {
    expect(graph.getById('nonexistent')).toBeNull();
  });

  it('findByType 无 arcId', () => {
    graph.create(testEntity);
    graph.create({ ...testEntity, id: 'loc-001', name: '天平城', type: 'location' });

    const characters = graph.findByType('character');
    expect(characters).toHaveLength(1);
    expect(characters[0].name).toBe('林逸');

    const locations = graph.findByType('location');
    expect(locations).toHaveLength(1);
  });

  it('findByType 带 arcId 过滤（含 permanent）', () => {
    graph.create(testEntity); // permanent, arc-1
    graph.create({
      ...testEntity,
      id: 'char-002',
      name: '配角A',
      persistence: 'arc',
      arcId: 'arc-1',
    });
    graph.create({
      ...testEntity,
      id: 'char-003',
      name: '配角B',
      persistence: 'arc',
      arcId: 'arc-2',
    });

    const arc1Chars = graph.findByType('character', 'arc-1');
    expect(arc1Chars).toHaveLength(2); // permanent + arc-1
    expect(arc1Chars.map((e) => e.name).sort()).toEqual(['林逸', '配角A']);
  });

  it('update 部分字段', () => {
    graph.create(testEntity);
    graph.update('char-001', { name: '林逸（觉醒后）', needsReview: true });

    const updated = graph.getById('char-001');
    expect(updated!.name).toBe('林逸（觉醒后）');
    expect(updated!.needsReview).toBe(true);
    expect(updated!.type).toBe('character'); // 未修改的字段保持不变
  });

  it('update 不存在的 id 不报错', () => {
    expect(() => graph.update('nonexistent', { name: 'x' })).not.toThrow();
  });

  it('delete', () => {
    graph.create(testEntity);
    expect(graph.getById('char-001')).not.toBeNull();

    graph.delete('char-001');
    expect(graph.getById('char-001')).toBeNull();
  });

  it('findNeedsReview', () => {
    graph.create({ ...testEntity, needsReview: true });
    graph.create({
      ...testEntity,
      id: 'char-002',
      name: '配角',
      needsReview: false,
    });

    const needsReview = graph.findNeedsReview();
    expect(needsReview).toHaveLength(1);
    expect(needsReview[0].id).toBe('char-001');
  });

  it('metadata 支持复杂 JSON', () => {
    const complex = {
      ...testEntity,
      metadata: {
        skills: ['剑术', '内功'],
        stats: { attack: 100, defense: 80 },
        description: '一个复杂的角色',
      },
    };
    graph.create(complex);
    const found = graph.getById('char-001');
    expect(found!.metadata).toEqual(complex.metadata);
  });
});
