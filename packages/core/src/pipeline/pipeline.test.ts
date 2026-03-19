// Preflight + WritePipeline 集成测试

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { preflightCheck } from './preflight.js';
import { ModelRouter } from './model-router.js';
import { WritePipeline } from './write-pipeline.js';
import { FileStateManager } from '../state/file-state-manager.js';
import type { LLMProvider, LLMCallResult, LLMStreamChunk } from '@lisan/llm';
import type { BookConfig } from '../plugin/types.js';

function createMockProvider(name: string, response?: Partial<LLMCallResult>): LLMProvider {
  return {
    name,
    call: vi.fn().mockResolvedValue({
      text: response?.text ?? '模拟生成内容',
      usage: {
        inputTokens: response?.usage?.inputTokens ?? 50,
        outputTokens: response?.usage?.outputTokens ?? 100,
      },
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
      id: 'draft-agent',
      name: '起草 Agent',
      systemPrompt: '你是起草专家。{{instructions}}',
      model: 'worker-model',
      temperature: 0.85,
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
    {
      id: 'data-agent',
      name: 'Data Agent',
      systemPrompt: '你是数据专家。{{instructions}}',
      model: 'worker-model',
      temperature: 0.3,
    },
  ],
};

describe('preflightCheck', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'lisan-preflight-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('缺少必要文件时抛出错误', async () => {
    await expect(preflightCheck(tempDir, 1)).rejects.toThrow('Preflight 校验失败');
  });

  it('所有文件存在时通过', async () => {
    await mkdir(join(tempDir, '场景树'), { recursive: true });
    await mkdir(join(tempDir, '大纲'), { recursive: true });
    await mkdir(join(tempDir, '.lisan'), { recursive: true });
    await writeFile(join(tempDir, '场景树', 'scenes.md'), '# 场景树', 'utf-8');
    await writeFile(join(tempDir, '大纲', 'chapter-plan.md'), '# 章节规划', 'utf-8');

    const result = await preflightCheck(tempDir, 1);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('缺少 .lisan 目录时报错', async () => {
    await mkdir(join(tempDir, '场景树'), { recursive: true });
    await mkdir(join(tempDir, '大纲'), { recursive: true });
    await writeFile(join(tempDir, '场景树', 'scenes.md'), '', 'utf-8');
    await writeFile(join(tempDir, '大纲', 'chapter-plan.md'), '', 'utf-8');

    await expect(preflightCheck(tempDir, 1)).rejects.toThrow('.lisan');
  });
});

describe('ModelRouter', () => {
  it('getProvider 根据 model 匹配编排器', () => {
    const router = new ModelRouter({
      orchestrator: { provider: 'anthropic', model: 'orchestrator-model' },
      worker: { provider: 'openai', model: 'worker-model' },
    });

    const orch = router.getOrchestrator();
    const work = router.getWorker();
    expect(orch).toBeDefined();
    expect(work).toBeDefined();
    expect(orch).not.toBe(work);

    // model 匹配 orchestrator 时返回编排器
    const provider = router.getProvider({ id: 'ctx', name: 'test', systemPrompt: '', model: 'orchestrator-model' });
    expect(provider).toBe(orch);

    // model 不匹配时返回 worker
    const provider2 = router.getProvider({ id: 'draft', name: 'test', systemPrompt: '', model: 'worker-model' });
    expect(provider2).toBe(work);
  });
});

describe('WritePipeline', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'lisan-pipeline-'));
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
        '## 场���1',
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
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('dry-run 模式只生成执行包', async () => {
    const orchestrator = createMockProvider('orchestrator');
    const worker = createMockProvider('worker');
    const stateManager = new FileStateManager(tempDir);

    const pipeline = new WritePipeline({
      projectRoot: tempDir,
      bookConfig: testBookConfig,
      orchestratorProvider: orchestrator,
      workerProvider: worker,
      vectorStore: null,
      entityGraph: null,
      stateManager,
    });

    const result = await pipeline.run(1, { dryRun: true });
    expect(result.success).toBe(true);
    expect(result.outputs['contextPack']).toBeDefined();
    expect(result.outputs['draft']).toBeUndefined();
  });

  it('完整管线执行：draft → pass → review → data → 写入文件', async () => {
    const draftText = '这是起草的正文内容，主角在教室里被欺负。';
    const passText = '改写后的正文，体验更强烈。';
    const reviewText = '终审后的正文，完美无缺。';
    const dataJson = JSON.stringify({
      entities: [{ name: '恶霸', type: 'character', metadata: { role: '反派' } }],
      summary: '主角在教室被欺负后觉醒',
      keyPoints: ['被嘲笑', '觉醒'],
    });

    let callCount = 0;
    const mockProvider: LLMProvider = {
      name: 'mock',
      call: vi.fn().mockImplementation(() => {
        callCount++;
        let text: string;
        // 调用顺序: 1=draft, 2=pass-1, 3=review, 4=data
        if (callCount === 1) text = draftText;
        else if (callCount === 2) text = passText;
        else if (callCount === 3) text = reviewText;
        else text = dataJson;

        return Promise.resolve({
          text,
          usage: { inputTokens: 50, outputTokens: 100 },
        });
      }),
      stream: vi.fn() as () => AsyncIterable<LLMStreamChunk>,
    };

    const stateManager = new FileStateManager(tempDir);

    const pipeline = new WritePipeline({
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
    expect(result.outputs['draft']).toBe(draftText);
    expect(result.outputs['pass-1']).toBe(passText);
    expect(result.outputs['review']).toBe(reviewText);
    expect(result.outputs['final']).toBe(reviewText);
    expect(result.stats.totalTokens).toBeGreaterThan(0);

    // 验证文件已写入
    const { readFile } = await import('node:fs/promises');
    const written = await readFile(join(tempDir, '正文', 'chapter-001.md'), 'utf-8');
    expect(written).toBe(reviewText);

    // 验证状态已更新
    const state = await stateManager.load();
    expect(state.chapters[1]?.status).toBe('done');
  });

  it('rerunPass 只重跑指定 Pass', async () => {
    const rewrittenText = '重跑 Pass 1 后的内容';
    const reviewText = '终审通过';
    const dataJson = '{"entities":[],"summary":"摘要","keyPoints":[]}';

    let callCount = 0;
    const mockProvider: LLMProvider = {
      name: 'mock',
      call: vi.fn().mockImplementation(() => {
        callCount++;
        let text: string;
        // 1=draft, 2=rerun-pass-1, 3=review, 4=data
        if (callCount === 1) text = '初稿';
        else if (callCount === 2) text = rewrittenText;
        else if (callCount === 3) text = reviewText;
        else text = dataJson;

        return Promise.resolve({
          text,
          usage: { inputTokens: 30, outputTokens: 60 },
        });
      }),
      stream: vi.fn() as () => AsyncIterable<LLMStreamChunk>,
    };

    const stateManager = new FileStateManager(tempDir);

    const pipeline = new WritePipeline({
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
});
