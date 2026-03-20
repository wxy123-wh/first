#!/usr/bin/env node
// Lisan sidecar — JSON-RPC over stdio
// Usage: node main.js --project-path /path/to/project

import { createInterface } from 'node:readline';
import { basename } from 'node:path';
import { Engine } from '../engine.js';
import { RpcServer } from './rpc-server.js';
import { ensureDefaultWorkflows } from '../workflow/defaults.js';

function getProjectPath(): string {
  const idx = process.argv.indexOf('--project-path');
  if (idx === -1 || !process.argv[idx + 1]) {
    process.stderr.write('Error: --project-path is required\n');
    process.exit(1);
  }
  return process.argv[idx + 1];
}

function send(line: string): void {
  process.stdout.write(line + '\n');
}

async function main() {
  const projectPath = getProjectPath();
  const engine = new Engine({ projectPath, provider: null as any });
  engine.agents.seedBuiltins();

  const rpc = new RpcServer();

  // Forward WorkflowRuntime events as JSON-RPC notifications
  engine.runtime.on((event) => {
    send(rpc.notify(event.type, event as any));
  });

  // === project ===
  rpc.register('project.open', async ({ path }) => {
    const resolvedPath = path ?? projectPath;
    const project = engine.store.ensureProject(basename(resolvedPath), resolvedPath);
    return {
      opened: true,
      path: resolvedPath,
      projectId: project.id,
      projectName: project.name,
    };
  });
  rpc.register('project.get', async ({ id }) => engine.store.getProject(id));
  rpc.register('project.update', async ({ id, patch }) => engine.store.updateProject(id, patch));
  rpc.register('outline.get', async () => engine.store.getOutlineContent());
  rpc.register('outline.save', async ({ content }) => {
    engine.store.saveOutlineContent(content ?? '');
    return null;
  });

  // === workflow ===
  rpc.register('workflow.list', async ({ projectId }) =>
    ensureDefaultWorkflows(engine.store, projectId, engine.agents.list()));
  rpc.register('workflow.get', async ({ id }) => engine.store.getWorkflow(id));
  rpc.register('workflow.save', async ({ workflow }) => engine.store.saveWorkflow(workflow));
  rpc.register('workflow.delete', async ({ id }) => { engine.store.deleteWorkflow(id); return null; });

  // === agent ===
  rpc.register('agent.list', async () => engine.agents.list());
  rpc.register('agent.save', async ({ agent, ...direct }) => {
    const payload = agent ?? direct;
    if (payload?.id) {
      const { id, ...patch } = payload;
      return engine.agents.update(id, patch);
    }
    return engine.agents.register({
      name: payload?.name ?? '未命名智能体',
      agentMd: payload?.agentMd ?? '',
      provider: payload?.provider ?? 'openai',
      model: payload?.model ?? 'gpt-4o',
      temperature: payload?.temperature ?? 0.7,
      maxTokens: payload?.maxTokens,
      promptTemplate: payload?.promptTemplate ?? '{{instructions}}',
      inputSchema: payload?.inputSchema ?? [],
    });
  });
  rpc.register('agent.register', async ({ name, agentMd, provider, model, temperature, maxTokens, promptTemplate, inputSchema }) =>
    engine.agents.register({ name, agentMd, provider, model, temperature, maxTokens, promptTemplate, inputSchema }));
  rpc.register('agent.update', async ({ id, patch }) => engine.agents.update(id, patch));
  rpc.register('agent.duplicate', async ({ id }) => engine.agents.duplicate(id));
  rpc.register('agent.delete', async ({ id }) => { engine.agents.delete(id); return null; });
  rpc.register('agent.getMd', async ({ id }) => engine.agents.getAgentMd(id));
  rpc.register('agent.saveMd', async ({ id, content }) => {
    engine.agents.saveAgentMd(id, content);
    return null;
  });

  // === provider ===
  rpc.register('provider.list', async () => engine.store.getProviders());
  rpc.register('provider.save', async ({ provider }) => {
    const saved = engine.store.saveProvider(provider);
    engine.executor.clearProviderCache(saved.id);
    return saved;
  });
  rpc.register('provider.delete', async ({ id }) => {
    engine.store.deleteProvider(id);
    engine.executor.clearProviderCache(id);
    return null;
  });

  // === scene ===
  rpc.register('scene.list', async ({ projectId }) => engine.store.getScenes(projectId));
  rpc.register('scene.save', async ({ scene }) => engine.store.saveScene(scene));
  rpc.register('scene.delete', async ({ id }) => { engine.store.deleteScene(id); return null; });
  rpc.register('scene.reorder', async ({ ids }) => { engine.store.reorderScenes(ids); return null; });

  // === chapter ===
  rpc.register('chapter.list', async ({ projectId }) => engine.store.getChapters(projectId));
  rpc.register('chapter.get', async ({ id }) => engine.store.getChapter(id));
  rpc.register('chapter.save', async ({ chapter }) => engine.store.saveChapter(chapter));
  rpc.register('chapter.getContent', async ({ id }) => engine.store.getChapterContent(id));
  rpc.register('chapter.saveContent', async ({ id, content }) => { engine.store.saveChapterContent(id, content); return null; });

  // === execution ===
  rpc.register('execution.list', async ({ projectId }) => engine.store.getExecutions(projectId));
  rpc.register('execution.detail', async ({ id }) => engine.store.getExecutionDetail(id));
  rpc.register('execution.get', async ({ id }) => engine.store.getExecutionDetail(id));

  // === entity ===
  rpc.register('entity.list', async ({ projectId, type }) => engine.store.queryEntities(projectId, type));
  rpc.register('entity.query', async ({ projectId, type }) => engine.store.queryEntities(projectId, type));
  rpc.register('entity.save', async ({ entity }) => engine.store.saveEntity(entity));

  // === workflow control ===
  rpc.register('workflow.run', async ({ workflowId, globalContext, chapterId }) => {
    // Run async, events are forwarded via runtime.on()
    engine.runtime.run(workflowId, globalContext ?? {}, chapterId).catch((err: Error) => {
      send(rpc.notify('workflow:error', { message: err.message }));
    });
    return { started: true };
  });
  rpc.register('workflow.pause', async ({ executionId }) => { engine.runtime.pause(executionId); return null; });
  rpc.register('workflow.resume', async ({ executionId }) => { engine.runtime.resume(executionId); return null; });
  rpc.register('workflow.rerun', async ({ workflowId, globalContext, chapterId }) => {
    engine.runtime.run(workflowId, globalContext ?? {}, chapterId).catch((err: Error) => {
      send(rpc.notify('workflow:error', { message: err.message }));
    });
    return { started: true };
  });
  rpc.register('workflow.abort', async ({ executionId }) => { engine.runtime.abort(executionId); return null; });
  rpc.register('workflow.skip', async ({ executionId, stepId }) => { engine.runtime.skip(executionId, stepId); return null; });

  // Read stdin line by line
  const rl = createInterface({ input: process.stdin, terminal: false });

  rl.on('line', async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    const response = await rpc.handleMessage(trimmed);
    if (response !== null) send(response);
  });

  rl.on('close', () => {
    engine.close();
    process.exit(0);
  });
}

main();
