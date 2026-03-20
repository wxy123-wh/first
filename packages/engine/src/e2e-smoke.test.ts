import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { LLMProvider } from '@lisan/llm';
import { Engine } from './engine.js';
import type { WorkflowEvent } from './workflow/events.js';

function createSmokeProvider(): LLMProvider {
  let callIndex = 0;
  return {
    name: 'smoke-mock',
    async call() {
      callIndex += 1;
      if (callIndex === 1) {
        return {
          text: JSON.stringify({
            scenes: [
              {
                title: '烟雨渡口',
                characters: ['林澈', '追兵'],
                location: '南城渡口',
                eventSkeleton: ['夜渡', '埋伏', '反击'],
                tags: { sceneType: '冲突' },
              },
            ],
          }),
          usage: { inputTokens: 10, outputTokens: 20 },
        };
      }
      return {
        text: '检查通过',
        usage: { inputTokens: 8, outputTokens: 12 },
      };
    },
    async *stream() {
      yield { text: 'chunk', finishReason: 'stop' as const };
    },
  };
}

describe('P2 e2e smoke', () => {
  let workspaceDir: string | undefined;
  let engine: Engine | undefined;

  afterEach(async () => {
    engine?.close();
    if (workspaceDir) {
      await rm(workspaceDir, { recursive: true, force: true });
    }
  });

  it('creates project + chapter, runs workflow, and persists execution and scenes', async () => {
    workspaceDir = await mkdtemp(join(tmpdir(), 'lisan-p2-smoke-'));
    const projectDir = join(workspaceDir, 'project-smoke');
    await mkdir(projectDir, { recursive: true });

    engine = new Engine({
      projectPath: workspaceDir,
      provider: createSmokeProvider(),
    });
    engine.agents.seedBuiltins();

    const builtinAgents = engine.agents.list().filter((agent) => agent.category === 'builtin');
    expect(builtinAgents.length).toBeGreaterThanOrEqual(2);

    const project = engine.store.createProject('Smoke Project', projectDir);
    const chapter = engine.store.saveChapter({
      projectId: project.id,
      number: 1,
      title: '第一章',
      status: 'drafting',
      workflowId: undefined,
      contentPath: 'chapters/001.md',
    });
    engine.store.saveChapterContent(chapter.id, '# 第一章\n\n待写作');

    const workflow = engine.store.saveWorkflow({
      id: '',
      projectId: project.id,
      name: 'smoke-workflow',
      description: 'p2 smoke flow',
      steps: [
        { id: '', order: 0, agentId: builtinAgents[0].id, enabled: true },
        { id: '', order: 1, agentId: builtinAgents[1].id, enabled: true },
      ],
      createdAt: '',
      updatedAt: '',
    });

    const events: WorkflowEvent[] = [];
    engine.runtime.on((event) => events.push(event));

    await engine.runtime.run(
      workflow.id,
      {
        sourceOutline: '主角夜渡遇伏，迅速反击脱身。',
      },
      chapter.id,
    );

    const executions = engine.store.getExecutions(project.id);
    expect(executions).toHaveLength(1);
    expect(executions[0].status).toBe('completed');

    const detail = engine.store.getExecutionDetail(executions[0].id);
    expect(detail.steps).toHaveLength(2);
    expect(detail.steps.every((step) => step.status === 'completed')).toBe(true);

    const scenes = engine.store.getScenes(project.id);
    expect(scenes).toHaveLength(1);
    expect(scenes[0].chapterId).toBe(chapter.id);
    expect(scenes[0].title).toBe('烟雨渡口');

    const start = events.find((event) => event.type === 'workflow:start');
    const complete = events.find((event) => event.type === 'workflow:complete');
    expect(start?.type).toBe('workflow:start');
    expect(complete?.type).toBe('workflow:complete');
    if (start?.type === 'workflow:start' && complete?.type === 'workflow:complete') {
      expect(start.executionId).toBe(complete.executionId);
      expect(start.executionId).toBe(executions[0].id);
    }
  });
});
