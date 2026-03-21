import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WorkflowRuntime } from './runtime.js';
import type { WorkflowEvent } from './events.js';
import { StoreManager } from '../store/store-manager.js';
import { AgentRegistry } from '../agent/registry.js';
import { AgentExecutor } from '../agent/executor.js';
import { ContextBuilder } from './context-builder.js';
import type { LLMProvider } from '@lisan/llm';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const testDir = join(tmpdir(), 'lisan-runtime-test-' + Date.now());

function makeMockProvider(responses: string[] = ['output-1', 'output-2', 'output-3']): LLMProvider {
  let callIndex = 0;
  return {
    name: 'mock',
    async call() {
      const text = responses[callIndex++] ?? 'default-output';
      return { text, usage: { inputTokens: 10, outputTokens: 20 } };
    },
    async *stream() {
      yield { text: 'chunk', finishReason: 'stop' as const };
    },
  };
}

function waitForAbort(signal?: AbortSignal, timeoutMs = 300): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!signal) {
      setTimeout(resolve, timeoutMs);
      return;
    }
    if (signal.aborted) {
      const error = new Error('aborted');
      error.name = 'AbortError';
      reject(error);
      return;
    }
    const timer = setTimeout(resolve, timeoutMs);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      },
      { once: true },
    );
  });
}

function setupTestEnv() {
  mkdirSync(testDir, { recursive: true });
  const store = new StoreManager(testDir);
  const provider = makeMockProvider();
  const registry = new AgentRegistry(store);
  const executor = new AgentExecutor(provider);

  // Create project
  const project = store.createProject('test-project', testDir);

  // Seed agents so we have IDs
  registry.seedBuiltins();
  const agents = registry.list();
  const agent1 = agents[0];
  const agent2 = agents[1];

  // Create workflow with 3 steps (third disabled)
  const workflow = store.saveWorkflow({
    id: '',
    projectId: project.id,
    name: 'test-workflow',
    description: 'test',
    steps: [
      { id: '', order: 0, agentId: agent1.id, enabled: true },
      { id: '', order: 1, agentId: agent2.id, enabled: true },
      { id: '', order: 2, agentId: agent1.id, enabled: false },
    ],
    createdAt: '',
    updatedAt: '',
  });

  return { store, registry, executor, project, workflow, agent1, agent2 };
}

describe('WorkflowRuntime', () => {
  let store: StoreManager;

  afterEach(() => {
    store?.close();
    rmSync(testDir, { recursive: true, force: true });
  });

  it('executes steps in order, emitting start/complete events for each', async () => {
    const env = setupTestEnv();
    store = env.store;
    const runtime = new WorkflowRuntime(env.store, env.registry, env.executor);

    const events: WorkflowEvent[] = [];
    runtime.on(e => events.push(e));

    await runtime.run(env.workflow.id, {});

    // Should have: workflow:start, step:start, step:complete, step:start, step:complete, workflow:complete
    const types = events.map(e => e.type);
    expect(types[0]).toBe('workflow:start');
    expect(types[1]).toBe('step:start');
    expect(types[2]).toBe('step:complete');
    expect(types[3]).toBe('step:start');
    expect(types[4]).toBe('step:complete');
    expect(types[types.length - 1]).toBe('workflow:complete');
  });

  it('emits executionId for workflow and step events', async () => {
    const env = setupTestEnv();
    store = env.store;
    const runtime = new WorkflowRuntime(env.store, env.registry, env.executor);

    const events: WorkflowEvent[] = [];
    runtime.on((event) => events.push(event));

    await runtime.run(env.workflow.id, {});

    const executions = env.store.getExecutions(env.project.id);
    expect(executions.length).toBe(1);
    const executionId = executions[0].id;

    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      expect((event as { executionId?: string }).executionId).toBe(executionId);
    }
  });

  it('requires valid executionId for pause/resume/abort/skip controls', () => {
    const env = setupTestEnv();
    store = env.store;
    const runtime = new WorkflowRuntime(env.store, env.registry, env.executor);

    expect(() => runtime.pause('missing-execution-id' as never)).toThrow(/execution/i);
    expect(() => runtime.resume('missing-execution-id' as never)).toThrow(/execution/i);
    expect(() => runtime.abort('missing-execution-id' as never)).toThrow(/execution/i);
    expect(() =>
      runtime.skip('missing-execution-id' as never, env.workflow.steps[0].id),
    ).toThrow(/execution/i);
  });

  it('skips disabled steps', async () => {
    const env = setupTestEnv();
    store = env.store;
    const runtime = new WorkflowRuntime(env.store, env.registry, env.executor);

    const events: WorkflowEvent[] = [];
    runtime.on(e => events.push(e));

    await runtime.run(env.workflow.id, {});

    // Only 2 step:start events (third step is disabled)
    const stepStarts = events.filter(e => e.type === 'step:start');
    expect(stepStarts.length).toBe(2);
  });

  it('handles abort command — terminates with failed status', async () => {
    const env = setupTestEnv();
    store = env.store;

    // Slow provider to give time to abort
    let callCount = 0;
    const slowProvider: LLMProvider = {
      name: 'slow-mock',
      async call() {
        callCount++;
        if (callCount === 1) {
          return { text: 'first-output', usage: { inputTokens: 10, outputTokens: 20 } };
        }
        // Second call will be slow — runtime should abort before it completes
        await new Promise(resolve => setTimeout(resolve, 500));
        return { text: 'second-output', usage: { inputTokens: 10, outputTokens: 20 } };
      },
      async *stream() {
        yield { text: 'chunk', finishReason: 'stop' as const };
      },
    };

    const executor = new AgentExecutor(slowProvider);
    const runtime = new WorkflowRuntime(env.store, env.registry, executor);

    const events: WorkflowEvent[] = [];
    runtime.on(e => events.push(e));

    // Abort after first step completes
    runtime.on(e => {
      if (e.type === 'step:complete') runtime.abort(e.executionId);
    });

    await runtime.run(env.workflow.id, {});

    const types = events.map(e => e.type);
    expect(types).toContain('workflow:start');
    // Should not have a second step:complete
    const completes = events.filter(e => e.type === 'step:complete');
    expect(completes.length).toBe(1);
  });

  it('handles skip command — marks step as skipped, moves to next', async () => {
    const env = setupTestEnv();
    store = env.store;

    const runtime = new WorkflowRuntime(env.store, env.registry, env.executor);

    const events: WorkflowEvent[] = [];
    runtime.on(e => events.push(e));

    // Skip the first step
    const firstStepId = env.workflow.steps[0].id;
    runtime.on((event) => {
      if (event.type === 'workflow:start') {
        runtime.skip(event.executionId, firstStepId);
      }
    });

    await runtime.run(env.workflow.id, {});

    // First step should not have step:complete, only second step should
    const stepCompletes = events.filter(e => e.type === 'step:complete');
    expect(stepCompletes.length).toBe(1);
  });

  it('aborts running step by cancelling provider call and stops subsequent steps', async () => {
    const env = setupTestEnv();
    store = env.store;

    let callCount = 0;
    let abortSignalCount = 0;
    const provider: LLMProvider = {
      name: 'abort-aware-provider',
      async call(options) {
        callCount += 1;
        if (callCount === 1) {
          try {
            await waitForAbort(options.signal, 500);
          } catch (error) {
            if (error instanceof Error && error.name === 'AbortError') {
              abortSignalCount += 1;
              throw error;
            }
            throw error;
          }
          return { text: 'unexpected-first-output', usage: { inputTokens: 10, outputTokens: 20 } };
        }
        return { text: 'unexpected-next-output', usage: { inputTokens: 10, outputTokens: 20 } };
      },
      async *stream() {
        yield { text: 'chunk', finishReason: 'stop' as const };
      },
    };

    const runtime = new WorkflowRuntime(env.store, env.registry, new AgentExecutor(provider));
    const firstStepId = env.workflow.steps[0].id;
    runtime.on((event) => {
      if (event.type === 'step:start' && event.stepId === firstStepId) {
        runtime.abort(event.executionId);
      }
    });

    await runtime.run(env.workflow.id, {});

    expect(callCount).toBe(1);
    expect(abortSignalCount).toBe(1);

    const executions = env.store.getExecutions(env.project.id);
    expect(executions).toHaveLength(1);
    expect(executions[0].status).toBe('failed');

    const detail = env.store.getExecutionDetail(executions[0].id);
    expect(detail.steps).toHaveLength(1);
    expect(detail.steps[0].status).toBe('failed');
    expect(detail.steps[0].output).toContain('终止');
  });

  it('skips running step by cancelling provider call and continues with next step', async () => {
    const env = setupTestEnv();
    store = env.store;

    let callCount = 0;
    let abortSignalCount = 0;
    const provider: LLMProvider = {
      name: 'skip-aware-provider',
      async call(options) {
        callCount += 1;
        if (callCount === 1) {
          try {
            await waitForAbort(options.signal, 500);
          } catch (error) {
            if (error instanceof Error && error.name === 'AbortError') {
              abortSignalCount += 1;
              throw error;
            }
            throw error;
          }
          return { text: 'unexpected-first-output', usage: { inputTokens: 10, outputTokens: 20 } };
        }
        return { text: 'second-step-output', usage: { inputTokens: 10, outputTokens: 20 } };
      },
      async *stream() {
        yield { text: 'chunk', finishReason: 'stop' as const };
      },
    };

    const runtime = new WorkflowRuntime(env.store, env.registry, new AgentExecutor(provider));
    const firstStepId = env.workflow.steps[0].id;
    runtime.on((event) => {
      if (event.type === 'step:start' && event.stepId === firstStepId) {
        runtime.skip(event.executionId, firstStepId);
      }
    });

    await runtime.run(env.workflow.id, {});

    expect(callCount).toBe(2);
    expect(abortSignalCount).toBe(1);

    const executions = env.store.getExecutions(env.project.id);
    expect(executions).toHaveLength(1);
    expect(executions[0].status).toBe('completed');

    const detail = env.store.getExecutionDetail(executions[0].id);
    expect(detail.steps).toHaveLength(2);
    expect(detail.steps[0].status).toBe('skipped');
    expect(detail.steps[1].status).toBe('completed');
    expect(detail.steps[1].output).toBe('second-step-output');
  });

  it('does not carry skipped steps into later runs', async () => {
    const env = setupTestEnv();
    store = env.store;

    const runtime = new WorkflowRuntime(env.store, env.registry, env.executor);

    const firstStepId = env.workflow.steps[0].id;
    let shouldSkipFirstRun = true;
    runtime.on((event) => {
      if (event.type === 'workflow:start' && shouldSkipFirstRun) {
        shouldSkipFirstRun = false;
        runtime.skip(event.executionId, firstStepId);
      }
    });
    await runtime.run(env.workflow.id, {});

    const firstExecutionId = env.store.getExecutions(env.project.id)[0].id;

    await runtime.run(env.workflow.id, {});

    const executions = env.store.getExecutions(env.project.id);
    expect(executions.length).toBe(2);

    const secondExecution = executions.find(execution => execution.id !== firstExecutionId);
    expect(secondExecution).toBeDefined();

    const secondDetail = env.store.getExecutionDetail(secondExecution!.id);
    expect(secondDetail.steps.length).toBe(2);
    expect(secondDetail.steps.every(step => step.status === 'completed')).toBe(true);
  });

  it('persists execution state to StoreManager after each step', async () => {
    const env = setupTestEnv();
    store = env.store;
    const runtime = new WorkflowRuntime(env.store, env.registry, env.executor);

    await runtime.run(env.workflow.id, {});

    const executions = env.store.getExecutions(env.project.id);
    expect(executions.length).toBe(1);
    expect(executions[0].status).toBe('completed');

    const detail = env.store.getExecutionDetail(executions[0].id);
    // 2 enabled steps executed
    expect(detail.steps.length).toBe(2);
    expect(detail.steps[0].status).toBe('completed');
    expect(detail.steps[1].status).toBe('completed');
    expect(detail.steps[0].output).toBe('output-1');
    expect(detail.steps[1].output).toBe('output-2');
  });

  it('isolates control commands by executionId across parallel runs', async () => {
    const env = setupTestEnv();
    store = env.store;

    let callIndex = 0;
    const delayedProvider: LLMProvider = {
      name: 'delayed-provider',
      async call() {
        callIndex += 1;
        await new Promise((resolve) => setTimeout(resolve, 80));
        return {
          text: `output-${callIndex}`,
          usage: { inputTokens: 10, outputTokens: 20 },
        };
      },
      async *stream() {
        yield { text: 'chunk', finishReason: 'stop' as const };
      },
    };
    const runtime = new WorkflowRuntime(env.store, env.registry, new AgentExecutor(delayedProvider));

    const workflow2 = env.store.saveWorkflow({
      id: '',
      projectId: env.project.id,
      name: 'parallel-workflow',
      description: 'parallel test workflow',
      steps: [
        { id: '', order: 0, agentId: env.agent1.id, enabled: true },
        { id: '', order: 1, agentId: env.agent2.id, enabled: true },
      ],
      createdAt: '',
      updatedAt: '',
    });

    const runA = runtime.run(env.workflow.id, {});
    const runB = runtime.run(workflow2.id, {});

    await new Promise((resolve) => setTimeout(resolve, 100));
    const executions = env.store.getExecutions(env.project.id);
    const executionA = executions.find((execution) => execution.workflowId === env.workflow.id);
    expect(executionA).toBeDefined();

    runtime.abort(executionA!.id as never);

    await Promise.all([runA, runB]);

    const latestExecutions = env.store.getExecutions(env.project.id);
    const runAStatus = latestExecutions.find((execution) => execution.id === executionA!.id)?.status;
    const runBStatus = latestExecutions.find((execution) => execution.workflowId === workflow2.id)?.status;

    expect(runAStatus).toBe('failed');
    expect(runBStatus).toBe('completed');
  });

  it('handles pause and resume commands', async () => {
    const env = setupTestEnv();
    store = env.store;

    let resolveResume: () => void;
    const resumePromise = new Promise<void>(r => { resolveResume = r; });

    const slowProvider: LLMProvider = {
      name: 'slow-mock',
      async call() {
        return { text: 'output', usage: { inputTokens: 10, outputTokens: 20 } };
      },
      async *stream() {
        yield { text: 'chunk', finishReason: 'stop' as const };
      },
    };

    const executor = new AgentExecutor(slowProvider);
    const runtime = new WorkflowRuntime(env.store, env.registry, executor);

    const events: WorkflowEvent[] = [];
    runtime.on(e => events.push(e));

    // Pause after first step completes, then resume after a tick
    let paused = false;
    runtime.on(e => {
      if (e.type === 'step:complete' && !paused) {
        paused = true;
        runtime.pause(e.executionId);
        // Resume after a short delay
        setTimeout(() => {
          runtime.resume(e.executionId);
          resolveResume!();
        }, 50);
      }
    });

    await runtime.run(env.workflow.id, {});

    // Both steps should eventually complete
    const stepCompletes = events.filter(e => e.type === 'step:complete');
    expect(stepCompletes.length).toBe(2);
  });

  it('handles rerun command — re-executes from target step', async () => {
    const env = setupTestEnv();
    store = env.store;

    const responses = ['first-1', 'first-2', 'rerun-1', 'rerun-2'];
    let callIndex = 0;
    const trackingProvider: LLMProvider = {
      name: 'tracking-mock',
      async call() {
        const text = responses[callIndex++] ?? 'extra';
        return { text, usage: { inputTokens: 10, outputTokens: 20 } };
      },
      async *stream() {
        yield { text: 'chunk', finishReason: 'stop' as const };
      },
    };

    const executor = new AgentExecutor(trackingProvider);
    const runtime = new WorkflowRuntime(env.store, env.registry, executor);

    const events: WorkflowEvent[] = [];
    runtime.on(e => events.push(e));

    // Run first time
    await runtime.run(env.workflow.id, {});

    const executions = env.store.getExecutions(env.project.id);
    const executionId = executions[0].id;

    // Rerun from first step
    const firstStepId = env.workflow.steps[0].id;
    await runtime.rerun(executionId, firstStepId);

    // Check that the execution steps were re-executed
    const detail = env.store.getExecutionDetail(executionId);
    expect(detail.steps[0].output).toBe('rerun-1');
    expect(detail.steps[1].output).toBe('rerun-2');
  });

  it('builds decompose instructions from sourceOutline and persists scene cards from JSON output', async () => {
    const env = setupTestEnv();
    store = env.store;

    const sourceOutline = '主角被围堵后反杀，奠定第一章冲突。';
    let firstUserPrompt = '';
    let callCount = 0;
    const provider: LLMProvider = {
      name: 'capture-mock',
      async call(options) {
        callCount += 1;
        const userPrompt = options.messages.find((message) => message.role === 'user')?.content ?? '';
        if (callCount === 1) {
          firstUserPrompt = userPrompt;
          return {
            text: JSON.stringify({
              scenes: [
                {
                  title: '死巷反杀',
                  characters: ['卡列尔', '打手'],
                  location: '旧城区死胡同',
                  eventSkeleton: ['被堵截', '假意示弱', '瞬间反杀'],
                  tags: { sceneType: '战斗' },
                },
              ],
            }),
            usage: { inputTokens: 10, outputTokens: 20 },
          };
        }
        return {
          text: '检验通过',
          usage: { inputTokens: 8, outputTokens: 6 },
        };
      },
      async *stream() {
        yield { text: 'chunk', finishReason: 'stop' as const };
      },
    };

    const executor = new AgentExecutor(provider);
    const runtime = new WorkflowRuntime(
      env.store,
      env.registry,
      executor,
      new ContextBuilder(env.store),
    );

    await runtime.run(env.workflow.id, { sourceOutline });

    expect(firstUserPrompt).toContain(sourceOutline);
    expect(firstUserPrompt).toContain('"scenes"');

    const scenes = env.store.getScenes(env.project.id);
    expect(scenes.length).toBe(1);
    expect(scenes[0].title).toBe('死巷反杀');
    expect(scenes[0].characters).toEqual(['卡列尔', '打手']);
    expect(scenes[0].location).toBe('旧城区死胡同');
    expect(scenes[0].eventSkeleton).toEqual(['被堵截', '假意示弱', '瞬间反杀']);
    expect(scenes[0].sourceOutline).toBe(sourceOutline);
  });

  it('uses stage-specific scene instruction templates with enriched decompose context', async () => {
    const env = setupTestEnv();
    store = env.store;

    env.store.updateProject(env.project.id, {
      sceneTagTemplate: [
        { key: 'sceneType', label: '场景类型', options: ['战斗', '转场', '揭示'] },
      ],
    });
    env.store.saveSetting({
      projectId: env.project.id,
      title: '组织法则',
      tags: ['势力'],
      summary: '每个势力都遵循明确的奖惩机制。',
      content: '组织规则：越级挑战必须付出代价。',
    });
    const chapter = env.store.saveChapter({
      projectId: env.project.id,
      number: 1,
      title: '第一章',
      status: 'drafting',
      contentPath: 'chapters/001.md',
    });
    env.store.saveScene({
      projectId: env.project.id,
      chapterId: chapter.id,
      parentId: undefined,
      order: 0,
      title: '雨夜埋伏',
      characters: ['甲', '乙'],
      location: '旧港',
      eventSkeleton: ['潜伏', '短兵相接'],
      tags: { sceneType: '战斗' },
      sourceOutline: '旧港夜袭',
    });

    const builtins = env.registry.list();
    const decomposeAgent = builtins.find((agent) => /拆解|decompose/i.test(agent.name));
    const transitionAgent = builtins.find((agent) => /过渡|transition/i.test(agent.name));
    const validationAgent = builtins.find((agent) => /检验|validation/i.test(agent.name));
    expect(decomposeAgent).toBeDefined();
    expect(transitionAgent).toBeDefined();
    expect(validationAgent).toBeDefined();

    const workflow = env.store.saveWorkflow({
      id: '',
      projectId: env.project.id,
      name: '场景生成链路',
      description: 'decompose -> transition -> validation',
      kind: 'scene',
      steps: [
        { id: '', order: 0, agentId: decomposeAgent!.id, enabled: true },
        { id: '', order: 1, agentId: transitionAgent!.id, enabled: true },
        { id: '', order: 2, agentId: validationAgent!.id, enabled: true },
      ],
      createdAt: '',
      updatedAt: '',
    });

    const prompts: string[] = [];
    const provider: LLMProvider = {
      name: 'capture-scene-stage-prompts',
      async call(options) {
        const userPrompt = options.messages.find((message) => message.role === 'user')?.content ?? '';
        prompts.push(userPrompt);
        if (prompts.length === 1) {
          return {
            text: JSON.stringify({
              scenes: [
                {
                  title: '旧港围捕',
                  characters: ['甲', '乙'],
                  location: '旧港仓库',
                  eventSkeleton: ['设伏', '爆发冲突', '主角脱困'],
                  tags: { sceneType: '战斗' },
                },
              ],
            }),
            usage: { inputTokens: 10, outputTokens: 20 },
          };
        }
        if (prompts.length === 2) {
          return {
            text: JSON.stringify({ note: 'transition-pass' }),
            usage: { inputTokens: 10, outputTokens: 20 },
          };
        }
        return {
          text: 'validation-pass',
          usage: { inputTokens: 10, outputTokens: 20 },
        };
      },
      async *stream() {
        yield { text: 'chunk', finishReason: 'stop' as const };
      },
    };

    const runtime = new WorkflowRuntime(
      env.store,
      env.registry,
      new AgentExecutor(provider),
      new ContextBuilder(env.store),
    );

    await runtime.run(
      workflow.id,
      { sourceOutline: '主角在旧港遭遇围捕并尝试反制。' },
      chapter.id,
    );

    expect(prompts).toHaveLength(3);
    expect(prompts[0]).toContain('任务：拆解场景');
    expect(prompts[1]).toContain('任务：补全场景转场');
    expect(prompts[2]).toContain('任务：检验场景一致性');

    expect(prompts[0]).toContain('当前章节信息');
    expect(prompts[0]).toContain('最近场景摘要');
    expect(prompts[0]).toContain('设定集摘要');
    expect(prompts[0]).toContain('标签模板约束');
    expect(prompts[0]).toContain('禁止输出解释文字');
  });

  it('returns explicit missing-context error for scene workflows without outline or instructions', async () => {
    const env = setupTestEnv();
    store = env.store;

    const decomposeAgent = env.registry
      .list()
      .find((agent) => /拆解|decompose/i.test(agent.name));
    expect(decomposeAgent).toBeDefined();

    const workflow = env.store.saveWorkflow({
      id: '',
      projectId: env.project.id,
      name: '场景工作流-缺少上下文',
      description: '用于测试缺少关键上下文报错',
      kind: 'scene',
      steps: [{ id: '', order: 0, agentId: decomposeAgent!.id, enabled: true }],
      createdAt: '',
      updatedAt: '',
    });

    const runtime = new WorkflowRuntime(
      env.store,
      env.registry,
      env.executor,
      new ContextBuilder(env.store),
    );

    await expect(runtime.run(workflow.id, {})).rejects.toThrow('缺少关键上下文');
    expect(env.store.getExecutions(env.project.id)).toHaveLength(0);
  });

  it('binds scenes without chapterId to run chapter and reports fallback summary', async () => {
    const env = setupTestEnv();
    store = env.store;

    const chapter = env.store.saveChapter({
      projectId: env.project.id,
      number: 1,
      title: '第一章',
      status: 'drafting',
      contentPath: 'chapters/001.md',
    });

    const provider: LLMProvider = {
      name: 'scene-fallback-summary',
      async call() {
        return {
          text: JSON.stringify({
            scenes: [
              {
                title: '无章场景',
                characters: ['甲'],
                location: '旧港',
                eventSkeleton: ['夜行', '遭遇'],
                tags: { mood: '紧张' },
              },
            ],
          }),
          usage: { inputTokens: 10, outputTokens: 20 },
        };
      },
      async *stream() {
        yield { text: 'chunk', finishReason: 'stop' as const };
      },
    };

    const runtime = new WorkflowRuntime(
      env.store,
      env.registry,
      new AgentExecutor(provider),
      new ContextBuilder(env.store),
    );
    const events: WorkflowEvent[] = [];
    runtime.on((event) => events.push(event));

    await runtime.run(
      env.workflow.id,
      { sourceOutline: '用于测试 chapterId 兜底绑定' },
      chapter.id,
    );

    const scenes = env.store.getScenes(env.project.id);
    expect(scenes).toHaveLength(1);
    expect(scenes[0].chapterId).toBe(chapter.id);

    const complete = events.find((event) => event.type === 'workflow:complete');
    expect(complete?.type).toBe('workflow:complete');
    if (complete?.type === 'workflow:complete') {
      expect(complete.summary).toContain('本次绑定章节 1 条');
      expect(complete.summary).toContain('未绑定章节 0 条');
      expect(complete.summary).toContain('缺失 chapterId');
      expect(complete.summary).toContain('兜底绑定');
    }
  });

  it('injects chapter-scoped context fields for chapterId run (chapter/scenes/entities/previousTail)', async () => {
    const env = setupTestEnv();
    store = env.store;

    const chapter1 = env.store.saveChapter({
      projectId: env.project.id,
      number: 1,
      title: '序章',
      status: 'drafting',
      contentPath: 'chapters/001.md',
    });
    const chapter2 = env.store.saveChapter({
      projectId: env.project.id,
      number: 2,
      title: '第二章',
      status: 'drafting',
      contentPath: 'chapters/002.md',
    });
    env.store.saveChapterContent(chapter1.id, '这是第一章末尾收束。');
    env.store.saveScene({
      projectId: env.project.id,
      chapterId: chapter2.id,
      parentId: undefined,
      order: 0,
      title: '夜巷追击',
      characters: ['卡列尔'],
      location: '旧城区',
      eventSkeleton: ['追击', '失手', '反制'],
      tags: {},
      sourceOutline: '',
    });
    env.store.saveEntity({
      projectId: env.project.id,
      type: 'character',
      name: '卡列尔',
      data: {},
    });

    const customAgent = env.registry.register({
      name: 'chapter-context-test-agent',
      agentMd: 'system',
      provider: 'openai',
      model: 'gpt-4o',
      temperature: 0.3,
      promptTemplate: '章={{chapter.title}}\n场景={{scenes}}\n实体={{entities}}\n衔接={{previousTail}}',
      inputSchema: [],
    });
    const chapterWorkflow = env.store.saveWorkflow({
      id: '',
      projectId: env.project.id,
      name: 'chapter-context-workflow',
      description: 'test chapter context injection',
      steps: [
        { id: '', order: 0, agentId: customAgent.id, enabled: true },
      ],
      createdAt: '',
      updatedAt: '',
    });

    let firstPrompt = '';
    let callCount = 0;
    const provider: LLMProvider = {
      name: 'capture-context',
      async call(options) {
        callCount += 1;
        if (callCount === 1) {
          firstPrompt = options.messages.find((message) => message.role === 'user')?.content ?? '';
        }
        return {
          text: 'ok',
          usage: { inputTokens: 10, outputTokens: 20 },
        };
      },
      async *stream() {
        yield { text: 'chunk', finishReason: 'stop' as const };
      },
    };

    const runtime = new WorkflowRuntime(
      env.store,
      env.registry,
      new AgentExecutor(provider),
      new ContextBuilder(env.store),
    );

    await runtime.run(chapterWorkflow.id, {}, chapter2.id);

    expect(firstPrompt).toContain('第二章');
    expect(firstPrompt).toContain('夜巷追击');
    expect(firstPrompt).toContain('卡列尔');
    expect(firstPrompt).toContain('这是第一章末尾收束。');
  });

  it('writes chapter content from explicit primary output step after chapter workflow completion', async () => {
    const env = setupTestEnv();
    store = env.store;

    const chapter = env.store.saveChapter({
      projectId: env.project.id,
      number: 1,
      title: '第一章',
      status: 'drafting',
      contentPath: 'chapters/001.md',
    });
    env.store.saveChapterContent(chapter.id, '# 第一章\n\n旧内容');

    const workflow = env.store.saveWorkflow({
      id: '',
      projectId: env.project.id,
      name: 'chapter-content-sync-workflow',
      description: 'ensure chapter content sync',
      steps: [
        { id: '', order: 0, agentId: env.agent1.id, enabled: true, config: { primaryOutput: true } },
        { id: '', order: 1, agentId: env.agent2.id, enabled: true },
        { id: '', order: 2, agentId: env.agent1.id, enabled: true },
      ],
      createdAt: '',
      updatedAt: '',
    });

    const runtime = new WorkflowRuntime(
      env.store,
      env.registry,
      new AgentExecutor(makeMockProvider(['主正文', '中间改写', '{"entities":[]}'])),
      new ContextBuilder(env.store),
    );

    await runtime.run(workflow.id, { instructions: 'write chapter' }, chapter.id);

    expect(env.store.getChapterContent(chapter.id)).toBe('主正文');
  });

  it('marks execution as failed when chapter content persistence fails', async () => {
    const env = setupTestEnv();
    store = env.store;

    const chapter = env.store.saveChapter({
      projectId: env.project.id,
      number: 1,
      title: '第一章',
      status: 'drafting',
      contentPath: 'chapters/001.md',
    });

    const workflow = env.store.saveWorkflow({
      id: '',
      projectId: env.project.id,
      name: 'chapter-content-failure-workflow',
      description: 'ensure chapter content write failure marks execution failed',
      steps: [
        { id: '', order: 0, agentId: env.agent1.id, enabled: true, config: { primaryOutput: true } },
      ],
      createdAt: '',
      updatedAt: '',
    });

    const saveSpy = vi.spyOn(env.store, 'saveChapterContent').mockImplementation(() => {
      throw new Error('disk full');
    });
    const runtime = new WorkflowRuntime(
      env.store,
      env.registry,
      new AgentExecutor(makeMockProvider(['正文输出'])),
      new ContextBuilder(env.store),
    );

    await runtime.run(workflow.id, {}, chapter.id);

    expect(saveSpy).toHaveBeenCalledTimes(1);
    const executions = env.store.getExecutions(env.project.id);
    expect(executions).toHaveLength(1);
    expect(executions[0].status).toBe('failed');
  });

  it('fails current step when rendered template still has unresolved placeholders', async () => {
    const env = setupTestEnv();
    store = env.store;

    const customAgent = env.registry.register({
      name: 'unresolved-template-test-agent',
      agentMd: 'system',
      provider: 'openai',
      model: 'gpt-4o',
      temperature: 0.3,
      promptTemplate: '任务={{instructions}}\n缺失={{missing.value}}',
      inputSchema: [],
    });
    const placeholderWorkflow = env.store.saveWorkflow({
      id: '',
      projectId: env.project.id,
      name: 'placeholder-workflow',
      description: 'test unresolved placeholders',
      steps: [
        { id: '', order: 0, agentId: customAgent.id, enabled: true },
      ],
      createdAt: '',
      updatedAt: '',
    });

    const runtime = new WorkflowRuntime(
      env.store,
      env.registry,
      env.executor,
      new ContextBuilder(env.store),
    );

    await runtime.run(placeholderWorkflow.id, { instructions: '请生成内容' });

    const executions = env.store.getExecutions(env.project.id);
    expect(executions.length).toBe(1);
    expect(executions[0].status).toBe('failed');

    const detail = env.store.getExecutionDetail(executions[0].id);
    expect(detail.steps.length).toBe(1);
    expect(detail.steps[0].status).toBe('failed');
    expect(detail.steps[0].output).toContain('未解析占位符');
    expect(detail.steps[0].output).toContain('{{missing.value}}');
  });

  it('parses scene workflow output from json fenced array root', async () => {
    const env = setupTestEnv();
    store = env.store;

    const provider: LLMProvider = {
      name: 'fenced-array-scenes',
      async call() {
        return {
          text: [
            '```json',
            JSON.stringify([
              {
                title: '数组根节点场景',
                characters: ['A'],
                location: 'X',
                eventSkeleton: ['one'],
                tags: {},
              },
            ]),
            '```',
          ].join('\n'),
          usage: { inputTokens: 8, outputTokens: 10 },
        };
      },
      async *stream() {
        yield { text: 'chunk', finishReason: 'stop' as const };
      },
    };

    const runtime = new WorkflowRuntime(
      env.store,
      env.registry,
      new AgentExecutor(provider),
      new ContextBuilder(env.store),
    );

    const events: WorkflowEvent[] = [];
    runtime.on((event) => events.push(event));

    await runtime.run(env.workflow.id, { sourceOutline: '用于测试严格 scenes 解析。' });

    const scenes = env.store.getScenes(env.project.id);
    expect(scenes.length).toBe(1);
    expect(scenes[0].title).toBe('数组根节点场景');

    const complete = events.find((event) => event.type === 'workflow:complete');
    expect(complete?.type).toBe('workflow:complete');
    if (complete?.type === 'workflow:complete') {
      expect(complete.summary).toContain('Workflow completed');
      expect(complete.summary).toContain('已保存 1 条场景');
      expect(complete.summary).toContain('未绑定章节 1 条');
    }
  });

  it('retries scene json parse once for mixed text output and recovers scenes', async () => {
    const env = setupTestEnv();
    store = env.store;

    const provider: LLMProvider = {
      name: 'repair-once-scenes',
      async call() {
        return {
          text: [
            '下面是场景拆解结果（含解释文本）：',
            '[',
            '{"title":"修复后场景","characters":["甲"],"location":"港口","eventSkeleton":["伏击"],"tags":{"mood":"紧张"}}',
            ']',
            '请查收。',
          ].join('\n'),
          usage: { inputTokens: 8, outputTokens: 10 },
        };
      },
      async *stream() {
        yield { text: 'chunk', finishReason: 'stop' as const };
      },
    };

    const runtime = new WorkflowRuntime(
      env.store,
      env.registry,
      new AgentExecutor(provider),
      new ContextBuilder(env.store),
    );

    const events: WorkflowEvent[] = [];
    runtime.on((event) => events.push(event));

    await runtime.run(env.workflow.id, { sourceOutline: '用于测试一次修复重试。' });

    const scenes = env.store.getScenes(env.project.id);
    expect(scenes.length).toBe(1);
    expect(scenes[0].title).toBe('修复后场景');

    const complete = events.find((event) => event.type === 'workflow:complete');
    expect(complete?.type).toBe('workflow:complete');
    if (complete?.type === 'workflow:complete') {
      expect(complete.summary).toContain('解析修复');
    }
  });

  it('marks execution as failed with explicit reason when scene outputs cannot be parsed', async () => {
    const env = setupTestEnv();
    store = env.store;

    const provider: LLMProvider = {
      name: 'invalid-json-scenes',
      async call() {
        return {
          text: '这是自然语言总结，不是 JSON。',
          usage: { inputTokens: 8, outputTokens: 10 },
        };
      },
      async *stream() {
        yield { text: 'chunk', finishReason: 'stop' as const };
      },
    };

    const runtime = new WorkflowRuntime(
      env.store,
      env.registry,
      new AgentExecutor(provider),
      new ContextBuilder(env.store),
    );

    const events: WorkflowEvent[] = [];
    runtime.on((event) => events.push(event));

    await runtime.run(env.workflow.id, { sourceOutline: '用于测试解析失败。' });

    const scenes = env.store.getScenes(env.project.id);
    expect(scenes.length).toBe(0);

    const executions = env.store.getExecutions(env.project.id);
    expect(executions).toHaveLength(1);
    expect(executions[0].status).toBe('failed');

    const complete = events.find((event) => event.type === 'workflow:complete');
    expect(complete?.type).toBe('workflow:complete');
    if (complete?.type === 'workflow:complete') {
      expect(complete.summary).toContain('Workflow failed');
      expect(complete.summary).toContain('场景写入失败');
      expect(complete.summary).toContain('JSON 解析失败');
    }
  });

  it('marks execution as failed when scene cards violate minimal schema constraints', async () => {
    const env = setupTestEnv();
    store = env.store;

    const provider: LLMProvider = {
      name: 'invalid-scene-schema',
      async call() {
        return {
          text: JSON.stringify({
            scenes: [
              {
                title: 123,
                eventSkeleton: '单字符串',
                tags: [],
              },
            ],
          }),
          usage: { inputTokens: 8, outputTokens: 10 },
        };
      },
      async *stream() {
        yield { text: 'chunk', finishReason: 'stop' as const };
      },
    };

    const runtime = new WorkflowRuntime(
      env.store,
      env.registry,
      new AgentExecutor(provider),
      new ContextBuilder(env.store),
    );

    const events: WorkflowEvent[] = [];
    runtime.on((event) => events.push(event));

    await runtime.run(env.workflow.id, { sourceOutline: '用于测试字段校验失败。' });

    const scenes = env.store.getScenes(env.project.id);
    expect(scenes.length).toBe(0);

    const executions = env.store.getExecutions(env.project.id);
    expect(executions).toHaveLength(1);
    expect(executions[0].status).toBe('failed');

    const complete = events.find((event) => event.type === 'workflow:complete');
    expect(complete?.type).toBe('workflow:complete');
    if (complete?.type === 'workflow:complete') {
      expect(complete.summary).toContain('Workflow failed');
      expect(complete.summary).toContain('字段校验失败');
      expect(complete.summary).toContain('title');
      expect(complete.summary).toContain('eventSkeleton');
      expect(complete.summary).toContain('tags');
    }
  });

  it('parses scene outputs on completion, de-duplicates by title+chapter+event fingerprint, and reports saved count', async () => {
    const env = setupTestEnv();
    store = env.store;

    env.store.saveScene({
      projectId: env.project.id,
      chapterId: undefined,
      parentId: undefined,
      order: 0,
      title: '死巷反杀',
      characters: ['卡列尔'],
      location: '旧城区',
      eventSkeleton: ['被堵截', '反杀'],
      tags: {},
      sourceOutline: 'existing',
    });

    const provider: LLMProvider = {
      name: 'dedupe-scenes',
      async call() {
        return {
          text: JSON.stringify({
            scenes: [
              {
                title: '死巷反杀',
                characters: ['卡列尔'],
                location: '旧城区',
                eventSkeleton: ['被堵截', '反杀'],
                tags: {},
              },
              {
                title: '旧桥伏击',
                characters: ['卡列尔', '伏击者'],
                location: '断桥',
                eventSkeleton: ['潜伏', '伏击'],
                tags: { sceneType: '战斗' },
              },
              {
                title: '旧桥伏击',
                characters: ['卡列尔', '伏击者'],
                location: '断桥',
                eventSkeleton: ['潜伏', '伏击'],
                tags: { sceneType: '战斗' },
              },
              {
                title: '死巷反杀',
                characters: ['卡列尔'],
                location: '旧城区',
                eventSkeleton: ['被堵截', '反杀', '补刀'],
                tags: {},
              },
            ],
          }),
          usage: { inputTokens: 10, outputTokens: 20 },
        };
      },
      async *stream() {
        yield { text: 'chunk', finishReason: 'stop' as const };
      },
    };

    const runtime = new WorkflowRuntime(
      env.store,
      env.registry,
      new AgentExecutor(provider),
      new ContextBuilder(env.store),
    );

    const events: WorkflowEvent[] = [];
    runtime.on((event) => events.push(event));

    await runtime.run(env.workflow.id, { sourceOutline: '主角被围堵后反杀。' });

    const scenes = env.store.getScenes(env.project.id);
    expect(scenes.length).toBe(3);
    expect(scenes.map((scene) => scene.title)).toContain('旧桥伏击');

    const complete = events.find((event) => event.type === 'workflow:complete');
    expect(complete?.type).toBe('workflow:complete');
    if (complete?.type === 'workflow:complete') {
      expect(complete.summary).toContain('已保存 2 条场景');
      expect(complete.summary).toContain('本次绑定章节 0 条');
      expect(complete.summary).toContain('未绑定章节 2 条');
    }
  });

  it('collects scene JSON from multiple step outputs after runtime completion', async () => {
    const env = setupTestEnv();
    store = env.store;

    let callCount = 0;
    const provider: LLMProvider = {
      name: 'multi-step-scenes',
      async call() {
        callCount += 1;
        if (callCount === 1) {
          return {
            text: JSON.stringify({
              scenes: [
                {
                  title: '首场景',
                  characters: ['甲'],
                  location: '城门',
                  eventSkeleton: ['入城'],
                  tags: {},
                },
              ],
            }),
            usage: { inputTokens: 6, outputTokens: 12 },
          };
        }
        return {
          text: JSON.stringify({
            scenes: [
              {
                title: '次场景',
                characters: ['乙'],
                location: '内城',
                eventSkeleton: ['对峙'],
                tags: {},
              },
            ],
          }),
          usage: { inputTokens: 6, outputTokens: 12 },
        };
      },
      async *stream() {
        yield { text: 'chunk', finishReason: 'stop' as const };
      },
    };

    const runtime = new WorkflowRuntime(
      env.store,
      env.registry,
      new AgentExecutor(provider),
      new ContextBuilder(env.store),
    );

    await runtime.run(env.workflow.id, { sourceOutline: '多步骤场景写回测试。' });

    const scenes = env.store.getScenes(env.project.id);
    expect(scenes.length).toBe(2);
    expect(scenes.map((scene) => scene.title)).toEqual(expect.arrayContaining(['首场景', '次场景']));
  });

  it('falls back to a provider with configured credentials when current provider has none', async () => {
    const env = setupTestEnv();
    store = env.store;

    env.store.saveProvider({
      id: 'newapi',
      name: 'NewAPI',
      type: 'newapi',
      model: 'gpt-4o',
      apiKey: 'fake-key',
      baseUrl: 'https://example.com/v1',
      createdAt: '',
      updatedAt: '',
    });

    const requestedProviders: string[] = [];
    const providerFactory = (providerName: string): LLMProvider => {
      requestedProviders.push(providerName);
      return {
        name: providerName,
        async call() {
          return { text: 'ok', usage: { inputTokens: 1, outputTokens: 1 } };
        },
        async *stream() {
          yield { text: 'chunk', finishReason: 'stop' as const };
        },
      };
    };

    const executor = new AgentExecutor(null, providerFactory, (providerName) => ({
      provider: providerName as 'anthropic' | 'openai' | 'newapi',
      apiKey: providerName === 'newapi' ? 'fake-key' : undefined,
    }));
    const runtime = new WorkflowRuntime(
      env.store,
      env.registry,
      executor,
      new ContextBuilder(env.store),
    );

    await runtime.run(env.workflow.id, {});

    expect(requestedProviders.length).toBeGreaterThan(0);
    expect(requestedProviders[0]).toBe('newapi');
  });

  it('persists failure reason into step output when execution fails', async () => {
    const env = setupTestEnv();
    store = env.store;

    const failingProvider: LLMProvider = {
      name: 'failing',
      async call() {
        throw new Error('mock provider failure');
      },
      async *stream() {
        yield { text: 'chunk', finishReason: 'stop' as const };
      },
    };
    const executor = new AgentExecutor(failingProvider);
    const runtime = new WorkflowRuntime(
      env.store,
      env.registry,
      executor,
      new ContextBuilder(env.store),
    );

    await runtime.run(env.workflow.id, {});

    const executions = env.store.getExecutions(env.project.id);
    expect(executions.length).toBe(1);
    expect(executions[0].status).toBe('failed');

    const detail = env.store.getExecutionDetail(executions[0].id);
    expect(detail.steps.length).toBe(1);
    expect(detail.steps[0].status).toBe('failed');
    expect(detail.steps[0].output).toContain('mock provider failure');
  });
});
