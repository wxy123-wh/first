// DecomposePipeline + PlanPipeline + RewritePipeline 测试

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DecomposePipeline } from './decompose-pipeline.js';
import { PlanPipeline } from './plan-pipeline.js';
import { RewritePipeline } from './rewrite-pipeline.js';
import { FileStateManager } from '../state/file-state-manager.js';
import type { LLMProvider, LLMCallResult, LLMStreamChunk } from '@lisan/llm';
import type { BookConfig } from '../plugin/types.js';

function createMockProvider(response?: string): LLMProvider {
  return {
    name: 'mock',
    call: vi.fn().mockResolvedValue({
      text: response ?? '模拟生成内容',
      usage: { inputTokens: 50, outputTokens: 100 },
    }),
    stream: vi.fn() as () => AsyncIterable<LLMStreamChunk>,
  };
}

const testBookConfig: BookConfig = {
  id: 'test-book',
  title: '测试小说',
  genre: '都市',
  targetWordCount: 100_000,
  chapterWordRange: [3000, 4000],
  thrillTypes: ['怒火宣泄'],
  protagonistId: 'protagonist',
  cameraRules: '锁定主角视角',
  sensorPriority: ['触觉', '听觉', '视觉'],
  antiAiWordlist: ['不禁', '竟然'],
  passDefinitions: [
    { id: 'pass-1', name: '体验植入', agentId: 'rewrite-pass-1', order: 1 },
  ],
  agentDefinitions: [
    {
      id: 'context-agent',
      name: 'Context Agent',
      systemPrompt: '你是上下文组装专家。{{instructions}}',
      model: 'orchestrator-model',
      temperature: 0.3,
    },
    {
      id: 'rewrite-pass-1',
      name: '体验植入 Pass',
      systemPrompt: '你是体验植入专家。{{instructions}}',
      model: 'worker-model',
      temperature: 0.8,
    },
    {
      id: 'review-agent',
      name: '终审 Agent',
      systemPrompt: '你是终审专家。{{instructions}}',
      model: 'orchestrator-model',
      temperature: 0.5,
    },
  ],
};

describe('DecomposePipeline', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'lisan-decompose-'));
    await mkdir(join(tempDir, '大纲'), { recursive: true });
    await mkdir(join(tempDir, '场景树'), { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('成功读取大纲并生成场景树', async () => {
    const nl = String.fromCharCode(10);
    await writeFile(join(tempDir, '大纲', 'arc-1.md'), '# 第一卷大纲' + nl + '主角觉醒', 'utf-8');

    const scenesContent = '# 第1章 觉醒' + nl + '## 场景1' + nl + '标题: 被欺负';
    const provider = createMockProvider(scenesContent);

    const pipeline = new DecomposePipeline({
      projectRoot: tempDir,
      bookConfig: testBookConfig,
      orchestratorProvider: provider,
      vectorStore: null,
    });

    const result = await pipeline.run('arc-1');
    expect(result.success).toBe(true);
    expect(result.outputs['scenes']).toBe(scenesContent);
    expect(result.stats.totalTokens).toBeGreaterThan(0);

    // 验证文件已写入
    const written = await readFile(join(tempDir, '场景树', 'scenes.md'), 'utf-8');
    expect(written).toBe(scenesContent);
  });

  it('大纲文件不存在时返回失败', async () => {
    const provider = createMockProvider();

    const pipeline = new DecomposePipeline({
      projectRoot: tempDir,
      bookConfig: testBookConfig,
      orchestratorProvider: provider,
      vectorStore: null,
    });

    const result = await pipeline.run('nonexistent');
    expect(result.success).toBe(false);
    expect(result.errors?.[0]?.step).toBe('read-outline');
  });

  it('回退到通用 outline.md', async () => {
    await writeFile(join(tempDir, '大纲', 'outline.md'), '# 通用大纲', 'utf-8');

    const provider = createMockProvider('场景树内容');

    const pipeline = new DecomposePipeline({
      projectRoot: tempDir,
      bookConfig: testBookConfig,
      orchestratorProvider: provider,
      vectorStore: null,
    });

    const result = await pipeline.run('missing-arc');
    expect(result.success).toBe(true);
  });
});

describe('PlanPipeline', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'lisan-plan-'));
    await mkdir(join(tempDir, '场景树'), { recursive: true });
    await mkdir(join(tempDir, '大纲'), { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('成功读取场景树并生成章节规划', async () => {
    const nl = String.fromCharCode(10);
    await writeFile(
      join(tempDir, '场景树', 'scenes.md'),
      ['# 第1章', '## 场景1', '标题: 被欺负', '类型: buildup'].join(nl),
      'utf-8',
    );

    const planContent = [
      '# 第1章 觉醒',
      '标题: 觉醒',
      '情绪任务: 压抑到爆发',
      '情绪曲线: 低-低-高',
      '爽点类型: 怒火宣泄',
      '章末钩子: 神秘人出现',
    ].join(nl);

    const provider = createMockProvider(planContent);

    const pipeline = new PlanPipeline({
      projectRoot: tempDir,
      bookConfig: testBookConfig,
      orchestratorProvider: provider,
      vectorStore: null,
    });

    const result = await pipeline.run('arc-1');
    expect(result.success).toBe(true);
    expect(result.outputs['chapterPlan']).toBe(planContent);
    expect(result.stats.totalTokens).toBeGreaterThan(0);

    // 验证文件已写入
    const written = await readFile(join(tempDir, '大纲', 'chapter-plan.md'), 'utf-8');
    expect(written).toBe(planContent);
  });

  it('场景树不存在时返回失败', async () => {
    // 删除场景树目录内容
    await rm(join(tempDir, '场景树'), { recursive: true, force: true });

    const provider = createMockProvider();

    const pipeline = new PlanPipeline({
      projectRoot: tempDir,
      bookConfig: testBookConfig,
      orchestratorProvider: provider,
      vectorStore: null,
    });

    const result = await pipeline.run('arc-1');
    expect(result.success).toBe(false);
    expect(result.errors?.[0]?.step).toBe('read-scenes');
  });

  it('大纲存在时作为补充参考', async () => {
    const nl = String.fromCharCode(10);
    await writeFile(join(tempDir, '场景树', 'scenes.md'), '# 场景树', 'utf-8');
    await writeFile(join(tempDir, '大纲', 'arc-1.md'), '# 大纲参考', 'utf-8');

    const provider = createMockProvider('规划内容');

    const pipeline = new PlanPipeline({
      projectRoot: tempDir,
      bookConfig: testBookConfig,
      orchestratorProvider: provider,
      vectorStore: null,
    });

    const result = await pipeline.run('arc-1');
    expect(result.success).toBe(true);

    // 验证 LLM 调用中包含了大纲参考
    const callArgs = (provider.call as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const userMsg = callArgs.messages.find((m: { role: string }) => m.role === 'user');
    expect(userMsg.content).toContain('大纲参考');
  });
});

describe('RewritePipeline', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'lisan-rewrite-'));
    await mkdir(join(tempDir, '场景树'), { recursive: true });
    await mkdir(join(tempDir, '大纲'), { recursive: true });
    await mkdir(join(tempDir, '正文'), { recursive: true });
    await mkdir(join(tempDir, '.lisan'), { recursive: true });

    const nl = String.fromCharCode(10);
    await writeFile(
      join(tempDir, '大纲', 'chapter-plan.md'),
      [
        '# 第1章',
        '标题: 觉醒',
        '情绪任务: 压抑到爆发',
        '情绪曲线: 低-低-高',
        '爽点类型: 怒火宣泄',
        '章末钩子: 神秘人出现',
      ].join(nl),
      'utf-8',
    );

    await writeFile(
      join(tempDir, '场景树', 'scenes.md'),
      [
        '# 第1章',
        '## 场景1',
        '标题: 被欺负',
        '类型: buildup',
        '规模: medium',
        '情绪任务: 压抑',
        '阶段: suppress',
        '角色: protagonist, bully',
        '地点: 教室',
        '事件: 被嘲笑, 忍耐',
        '允许创角: 否',
      ].join(nl),
      'utf-8',
    );

    // 写入已有正文（rewrite 的前置条件）
    await writeFile(
      join(tempDir, '正文', 'chapter-001.md'),
      '这是原始正文内容，主角在教室里被欺负。',
      'utf-8',
    );
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('完整改写管线：读取正文 → pass → review → 写回', async () => {
    const passText = '改写后的正文，体验更强烈。';
    const reviewText = '终审后的改写正文。';

    let callCount = 0;
    const mockProvider: LLMProvider = {
      name: 'mock',
      call: vi.fn().mockImplementation(() => {
        callCount++;
        let text: string;
        // 调用顺序: 1=context(被 ContextAgent 调用时跳过), 1=pass-1, 2=review
        if (callCount === 1) text = passText;
        else text = reviewText;

        return Promise.resolve({
          text,
          usage: { inputTokens: 50, outputTokens: 100 },
        });
      }),
      stream: vi.fn() as () => AsyncIterable<LLMStreamChunk>,
    };

    const stateManager = new FileStateManager(tempDir);

    const pipeline = new RewritePipeline({
      projectRoot: tempDir,
      bookConfig: testBookConfig,
      orchestratorProvider: mockProvider,
      workerProvider: mockProvider,
      vectorStore: null,
      entityGraph: null,
      stateManager,
    });

    const result = await pipeline.run(1, { noGit: true });
    expect(result.success).toBe(true);
    expect(result.outputs['original']).toBe('这是原始正文内容，主角在教室里被欺负。');
    expect(result.outputs['pass-1']).toBeDefined();
    expect(result.outputs['review']).toBeDefined();
    expect(result.outputs['final']).toBeDefined();
    expect(result.stats.totalTokens).toBeGreaterThan(0);

    // 验证文件已写回
    const written = await readFile(join(tempDir, '正文', 'chapter-001.md'), 'utf-8');
    expect(written).toBe(result.outputs['final']);

    // 验证状态已更新
    const state = await stateManager.load();
    expect(state.chapters[1]?.status).toBe('done');
  });

  it('章节文件不存在时返回失败', async () => {
    // 删除正文文件
    await rm(join(tempDir, '正文', 'chapter-001.md'));

    const mockProvider = createMockProvider();
    const stateManager = new FileStateManager(tempDir);

    const pipeline = new RewritePipeline({
      projectRoot: tempDir,
      bookConfig: testBookConfig,
      orchestratorProvider: mockProvider,
      workerProvider: mockProvider,
      vectorStore: null,
      entityGraph: null,
      stateManager,
    });

    const result = await pipeline.run(1, { noGit: true });
    expect(result.success).toBe(false);
    expect(result.errors?.[0]?.step).toBe('read-chapter');
  });

  it('rerunPass 只重跑指定 Pass', async () => {
    const rewrittenText = '重跑 Pass 1 后的改写内容';
    const reviewText = '终审通过';

    let callCount = 0;
    const mockProvider: LLMProvider = {
      name: 'mock',
      call: vi.fn().mockImplementation(() => {
        callCount++;
        let text: string;
        if (callCount === 1) text = rewrittenText;
        else text = reviewText;

        return Promise.resolve({
          text,
          usage: { inputTokens: 30, outputTokens: 60 },
        });
      }),
      stream: vi.fn() as () => AsyncIterable<LLMStreamChunk>,
    };

    const stateManager = new FileStateManager(tempDir);

    const pipeline = new RewritePipeline({
      projectRoot: tempDir,
      bookConfig: testBookConfig,
      orchestratorProvider: mockProvider,
      workerProvider: mockProvider,
      vectorStore: null,
      entityGraph: null,
      stateManager,
    });

    const result = await pipeline.run(1, { rerunPass: 1, noGit: true });
    expect(result.success).toBe(true);
    expect(result.outputs['pass-1']).toBe(rewrittenText);
  });

  it('gitCommit 被调用', async () => {
    const mockProvider = createMockProvider('改写内容');
    const stateManager = new FileStateManager(tempDir);
    const gitCommit = vi.fn().mockResolvedValue(undefined);

    const pipeline = new RewritePipeline({
      projectRoot: tempDir,
      bookConfig: testBookConfig,
      orchestratorProvider: mockProvider,
      workerProvider: mockProvider,
      vectorStore: null,
      entityGraph: null,
      stateManager,
      gitCommit,
    });

    const result = await pipeline.run(1);
    expect(result.success).toBe(true);
    expect(gitCommit).toHaveBeenCalledWith('refactor: 第1章改写完成');
  });
});
