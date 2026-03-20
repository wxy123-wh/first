import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { LLMProvider } from '@lisan/llm';
import { Engine } from './engine.js';
import type { WorkflowEvent } from './workflow/events.js';

function createMockProvider(outputs: string[]): LLMProvider {
  let callIndex = 0;
  return {
    name: 'mock',
    async call() {
      const text = outputs[callIndex++] ?? 'default-output';
      return {
        text,
        usage: { inputTokens: 10, outputTokens: 20 },
      };
    },
    async *stream() {
      yield { text: 'chunk', finishReason: 'stop' as const };
    },
  };
}

describe('Engine integration', () => {
  let workspaceDir: string | undefined;
  let engine: Engine | undefined;

  afterEach(async () => {
    engine?.close();
    if (workspaceDir) {
      await rm(workspaceDir, { recursive: true, force: true });
    }
  });

  it('runs full workflow and records execution/events in order', async () => {
    workspaceDir = await mkdtemp(join(tmpdir(), 'lisan-engine-integration-'));
    const projectDir = join(workspaceDir, 'project-a');
    await mkdir(projectDir, { recursive: true });

    engine = new Engine({
      projectPath: workspaceDir,
      provider: createMockProvider(['step-1-output', 'step-2-output']),
    });

    // 1. Seed builtins
    engine.agents.seedBuiltins();
    const builtinAgents = engine.agents.list().filter((agent) => agent.category === 'builtin');
    expect(builtinAgents.length).toBeGreaterThanOrEqual(2);

    // 2. Create project
    const project = engine.store.createProject('Integration Project', projectDir);

    // 3. Create workflow with 2 steps
    const workflow = engine.store.saveWorkflow({
      id: '',
      projectId: project.id,
      name: 'integration-workflow',
      description: 'integration test workflow',
      steps: [
        { id: '', order: 0, agentId: builtinAgents[0].id, enabled: true },
        { id: '', order: 1, agentId: builtinAgents[1].id, enabled: true },
      ],
      createdAt: '',
      updatedAt: '',
    });

    // 4. Run workflow + collect events
    const events: WorkflowEvent[] = [];
    engine.runtime.on((event) => events.push(event));
    await engine.runtime.run(workflow.id, { instructions: 'write chapter' });

    // 5. Verify execution record in store
    const executions = engine.store.getExecutions(project.id);
    expect(executions).toHaveLength(1);
    expect(executions[0].status).toBe('completed');

    const detail = engine.store.getExecutionDetail(executions[0].id);
    expect(detail.steps).toHaveLength(2);
    expect(detail.steps.map((step) => step.status)).toEqual(['completed', 'completed']);
    expect(detail.steps[0].output).toBe('step-1-output');
    expect(detail.steps[1].output).toBe('step-2-output');

    // 6. Verify events in order
    const types = events.map((event) => event.type);
    expect(types).toEqual([
      'workflow:start',
      'step:start',
      'step:complete',
      'step:start',
      'step:complete',
      'workflow:complete',
    ]);
  });
});
