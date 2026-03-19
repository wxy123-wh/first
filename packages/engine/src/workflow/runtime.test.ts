import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WorkflowRuntime } from './runtime.js';
import type { WorkflowEvent } from './events.js';
import { StoreManager } from '../store/store-manager.js';
import { AgentRegistry } from '../agent/registry.js';
import { AgentExecutor } from '../agent/executor.js';
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
      if (e.type === 'step:complete') runtime.abort();
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
    runtime.skip(firstStepId);

    await runtime.run(env.workflow.id, {});

    // First step should not have step:complete, only second step should
    const stepCompletes = events.filter(e => e.type === 'step:complete');
    expect(stepCompletes.length).toBe(1);
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
        runtime.pause();
        // Resume after a short delay
        setTimeout(() => {
          runtime.resume();
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
});
