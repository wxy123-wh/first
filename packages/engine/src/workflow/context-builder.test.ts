import { describe, it, expect, afterEach } from 'vitest';
import { ContextBuilder } from './context-builder.js';
import { StoreManager } from '../store/store-manager.js';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const testDir = join(tmpdir(), 'lisan-ctx-test-' + Date.now());

function setupTestEnv() {
  mkdirSync(testDir, { recursive: true });
  const store = new StoreManager(testDir);
  const project = store.createProject('test-project', testDir);

  // Create scenes
  const scene1 = store.saveScene({
    projectId: project.id, chapterId: undefined, order: 0,
    title: '开场', characters: ['张三'], location: '咖啡馆',
    eventSkeleton: ['张三走进咖啡馆'], tags: { mood: '紧张' },
    sourceOutline: '第一幕开场',
  });
  const scene2 = store.saveScene({
    projectId: project.id, chapterId: undefined, order: 1,
    title: '冲突', characters: ['张三', '李四'], location: '办公室',
    eventSkeleton: ['争吵爆发'], tags: { mood: '激烈' },
    sourceOutline: '矛盾升级',
  });

  // Create chapter
  const chapter = store.saveChapter({
    projectId: project.id, number: 1, title: '第一章',
    status: 'pending', contentPath: 'chapters/ch01.md',
  });

  // Assign scenes to chapter
  store.saveScene({ ...scene1, chapterId: chapter.id });
  store.saveScene({ ...scene2, chapterId: chapter.id });

  // Save chapter content for previous chapter tail
  const prevChapter = store.saveChapter({
    projectId: project.id, number: 0, title: '序章',
    status: 'done', contentPath: 'chapters/ch00.md',
  });
  store.saveChapterContent(prevChapter.id, '序章的最后几段内容，用于衔接。');

  // Create entities
  store.saveEntity({
    projectId: project.id, type: 'character', name: '张三',
    data: { age: 28, role: '主角' },
  });

  // Set tag template on project
  store.updateProject(project.id, {
    sceneTagTemplate: [{ key: 'mood', label: '情绪', options: ['紧张', '激烈', '平静'] }],
  });

  return { store, project, chapter, prevChapter, scene1, scene2 };
}

describe('ContextBuilder', () => {
  let store: StoreManager;

  afterEach(() => {
    store?.close();
    rmSync(testDir, { recursive: true, force: true });
  });

  it('buildChapterContext returns scenes, chapter, previousChapterTail, entities, outline', () => {
    const env = setupTestEnv();
    store = env.store;
    const builder = new ContextBuilder(env.store);

    const ctx = builder.buildChapterContext(env.chapter.id);

    expect(ctx.chapter).toBeDefined();
    expect(ctx.chapter.title).toBe('第一章');
    expect(ctx.scenes).toHaveLength(2);
    expect(ctx.scenes[0].title).toBe('开场');
    expect(ctx.previousChapterTail).toContain('序章的最后几段内容');
    expect(ctx.entities).toHaveLength(1);
    expect(ctx.entities[0].name).toBe('张三');
  });

  it('buildChapterContext returns empty previousChapterTail for first chapter', () => {
    const env = setupTestEnv();
    store = env.store;
    const builder = new ContextBuilder(env.store);

    // prevChapter is number 0, chapter is number 1 — so prevChapterTail should exist
    // But if we query for prevChapter (number 0), there's no chapter before it
    const ctx = builder.buildChapterContext(env.prevChapter.id);
    expect(ctx.previousChapterTail).toBe('');
  });

  it('buildDecomposeContext returns sourceOutline, existingScenes, tagTemplate', () => {
    const env = setupTestEnv();
    store = env.store;
    const builder = new ContextBuilder(env.store);

    const ctx = builder.buildDecomposeContext('大纲内容：故事从这里开始...', env.project.id);

    expect(ctx.sourceOutline).toBe('大纲内容：故事从这里开始...');
    expect(ctx.existingScenes).toHaveLength(2);
    expect(ctx.tagTemplate).toHaveLength(1);
    expect(ctx.tagTemplate[0].key).toBe('mood');
  });
});
