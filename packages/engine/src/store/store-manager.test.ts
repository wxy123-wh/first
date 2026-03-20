import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { StoreManager } from './store-manager.js';
import { Database } from './database.js';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let store: StoreManager;
let testDir: string;

beforeEach(() => {
  testDir = join(tmpdir(), 'lisan-store-' + Date.now());
  mkdirSync(testDir, { recursive: true });
  store = new StoreManager(testDir);
});

afterEach(() => {
  store.close();
  rmSync(testDir, { recursive: true, force: true });
});

describe('StoreManager — Projects', () => {
  it('saves and retrieves a project', () => {
    const project = store.createProject('Test Novel', testDir);
    const retrieved = store.getProject(project.id);
    expect(retrieved.name).toBe('Test Novel');
    expect(retrieved.basePath).toBe(testDir);
  });
});

describe('StoreManager — Workflows', () => {
  it('saves and retrieves workflows with steps', () => {
    const project = store.createProject('Test', testDir);
    const workflow = store.saveWorkflow({
      id: '', projectId: project.id, name: 'Write Flow',
      kind: 'chapter',
      description: 'Standard', steps: [
        { id: '', order: 0, agentId: 'agent-1', enabled: true },
        { id: '', order: 1, agentId: 'agent-2', enabled: true },
      ], createdAt: '', updatedAt: '',
    });
    const workflows = store.getWorkflows(project.id);
    expect(workflows).toHaveLength(1);
    expect(workflows[0].steps).toHaveLength(2);
    expect(workflows[0].steps[0].agentId).toBe('agent-1');
    expect(workflows[0].kind).toBe('chapter');
  });

  it('deletes workflow and cascades to steps', () => {
    const project = store.createProject('Test', testDir);
    const workflow = store.saveWorkflow({
      id: '', projectId: project.id, name: 'Flow',
      kind: 'chapter',
      description: '', steps: [
        { id: '', order: 0, agentId: 'a1', enabled: true },
      ], createdAt: '', updatedAt: '',
    });
    store.deleteWorkflow(workflow.id);
    expect(store.getWorkflows(project.id)).toHaveLength(0);
  });

  it('infers and persists workflow kind when missing from input', () => {
    const project = store.createProject('Test', testDir);
    const workflow = store.saveWorkflow({
      id: '',
      projectId: project.id,
      name: '场景拆解流程',
      description: '',
      steps: [],
      createdAt: '',
      updatedAt: '',
    });

    expect(workflow.kind).toBe('scene');
    const row = (store as any).db.raw
      .prepare('SELECT kind FROM workflows WHERE id = ?')
      .get(workflow.id) as { kind: string | null };
    expect(row.kind).toBe('scene');
  });

  it('backfills legacy workflow kind on startup', () => {
    const project = store.createProject('Test', testDir);
    const now = new Date().toISOString();
    const agent = store.saveAgent({
      id: '',
      name: '拆解 Agent',
      category: 'custom',
      provider: 'openai',
      model: 'gpt-4o',
      temperature: 0.7,
      agentMdPath: '.lisan/agents/decompose/agent.md',
      promptTemplate: '{{instructions}}',
      inputSchema: ['instructions'],
      createdAt: '',
      updatedAt: '',
    });

    const legacyWorkflowId = 'legacy-workflow';
    (store as any).db.raw
      .prepare(
        'INSERT INTO workflows (id, projectId, name, description, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(legacyWorkflowId, project.id, '旧工作流', '', now, now);
    (store as any).db.raw
      .prepare(
        'INSERT INTO workflow_steps (id, workflowId, "order", agentId, enabled, config) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run('legacy-step', legacyWorkflowId, 0, agent.id, 1, '{}');

    store.close();
    store = new StoreManager(testDir);

    const workflow = store.getWorkflow(legacyWorkflowId);
    expect(workflow.kind).toBe('scene');

    const row = (store as any).db.raw
      .prepare('SELECT kind FROM workflows WHERE id = ?')
      .get(legacyWorkflowId) as { kind: string | null };
    expect(row.kind).toBe('scene');
  });
});

describe('StoreManager — Agents', () => {
  it('saves and retrieves agents', () => {
    const agent = store.saveAgent({
      id: '', name: 'Draft Agent', category: 'custom',
      provider: 'openai', model: 'gpt-4o', temperature: 0.85,
      agentMdPath: '.lisan/agents/draft/agent.md',
      promptTemplate: 'Write a chapter based on {{context.scenes}}',
      inputSchema: ['scenes'], createdAt: '', updatedAt: '',
    });
    const agents = store.getAgents();
    expect(agents).toHaveLength(1);
    expect(agents[0].name).toBe('Draft Agent');
  });
});

describe('StoreManager — Providers', () => {
  it('seeds built-in providers and supports custom provider upsert', () => {
    const providers = store.getProviders();
    expect(providers.map((item) => item.id)).toEqual(
      expect.arrayContaining(['openai', 'anthropic', 'newapi']),
    );
    expect(providers.every((item) => item.model.length > 0)).toBe(true);

    const saved = store.saveProvider({
      id: 'corp-proxy',
      name: 'Corp Proxy',
      type: 'newapi',
      model: 'gpt-4.1',
      baseUrl: 'https://proxy.example.com/v1',
      apiKey: 'proxy-key',
      createdAt: '',
      updatedAt: '',
    });

    expect(saved.id).toBe('corp-proxy');
    expect(saved.model).toBe('gpt-4.1');
    expect(saved.baseUrl).toBe('https://proxy.example.com/v1');
    expect(saved.apiKey).toBe('proxy-key');

    const updated = store.saveProvider({
      ...saved,
      model: 'gpt-4.1-mini',
      baseUrl: 'https://proxy.example.com/v2',
      apiKey: 'proxy-key-2',
    });

    expect(updated.model).toBe('gpt-4.1-mini');
    expect(updated.baseUrl).toBe('https://proxy.example.com/v2');
    expect(updated.apiKey).toBe('proxy-key-2');
    expect(store.getProviders().find((item) => item.id === 'corp-proxy')?.baseUrl).toBe(
      'https://proxy.example.com/v2',
    );
  });

  it('keeps agent model synchronized with provider model', () => {
    const agent = store.saveAgent({
      id: '',
      name: 'Bound Agent',
      category: 'custom',
      provider: 'openai',
      model: 'any-old-model',
      temperature: 0.7,
      agentMdPath: '.lisan/agents/bound/agent.md',
      promptTemplate: '{{instructions}}',
      inputSchema: ['instructions'],
      createdAt: '',
      updatedAt: '',
    });

    // saveAgent aligns model to provider model
    expect(agent.model).toBe('gpt-4o');

    store.saveProvider({
      id: 'openai',
      name: 'OpenAI',
      type: 'openai',
      model: 'gpt-4.1',
      baseUrl: undefined,
      apiKey: undefined,
      createdAt: '',
      updatedAt: '',
    });

    const refreshed = store.getAgents().find((item) => item.id === agent.id);
    expect(refreshed?.model).toBe('gpt-4.1');
  });

  it('stores provider api key as ciphertext and clears plaintext column', () => {
    store.saveProvider({
      id: 'corp-proxy',
      name: 'Corp Proxy',
      type: 'newapi',
      model: 'gpt-4.1',
      baseUrl: 'https://proxy.example.com/v1',
      apiKey: 'proxy-key',
      createdAt: '',
      updatedAt: '',
    });

    const row = (store as any).db.raw
      .prepare('SELECT apiKey, apiKeyCiphertext FROM providers WHERE id = ?')
      .get('corp-proxy') as { apiKey: string | null; apiKeyCiphertext: string | null };
    expect(row.apiKey).toBeNull();
    expect(row.apiKeyCiphertext).toBeTruthy();
    expect(row.apiKeyCiphertext).not.toContain('proxy-key');

    const runtimeProvider = store.getProvider('corp-proxy');
    expect(runtimeProvider?.apiKey).toBe('proxy-key');
  });

  it('migrates legacy plaintext provider api key on startup', () => {
    const db = new Database(testDir);
    const now = new Date().toISOString();
    db.raw
      .prepare(
        `INSERT OR REPLACE INTO providers (id, name, type, model, baseUrl, apiKey, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'legacy-proxy',
        'Legacy Proxy',
        'newapi',
        'gpt-4o',
        'https://legacy.example.com/v1',
        'legacy-plain-key',
        now,
        now,
      );
    db.close();

    store.close();
    store = new StoreManager(testDir);

    const migratedRow = (store as any).db.raw
      .prepare('SELECT apiKey, apiKeyCiphertext FROM providers WHERE id = ?')
      .get('legacy-proxy') as { apiKey: string | null; apiKeyCiphertext: string | null };
    expect(migratedRow.apiKey).toBeNull();
    expect(migratedRow.apiKeyCiphertext).toBeTruthy();
    expect(migratedRow.apiKeyCiphertext).not.toContain('legacy-plain-key');

    const provider = store.getProvider('legacy-proxy');
    expect(provider?.apiKey).toBe('legacy-plain-key');
  });
});

describe('StoreManager — Scenes', () => {
  it('saves, retrieves, and reorders scenes', () => {
    const project = store.createProject('Test', testDir);
    const s1 = store.saveScene({
      id: '', projectId: project.id, order: 0, title: 'Scene A',
      characters: ['MC'], location: 'Arena', eventSkeleton: ['Fight'],
      tags: { type: '核心' }, sourceOutline: 'outline text',
      createdAt: '', updatedAt: '',
    });
    const s2 = store.saveScene({
      id: '', projectId: project.id, order: 1, title: 'Scene B',
      characters: [], location: 'Road', eventSkeleton: [],
      tags: {}, sourceOutline: '', createdAt: '', updatedAt: '',
    });
    const scenes = store.getScenes(project.id);
    expect(scenes).toHaveLength(2);
    expect(scenes[0].title).toBe('Scene A');

    // Reorder: B before A
    store.reorderScenes([s2.id, s1.id]);
    const reordered = store.getScenes(project.id);
    expect(reordered[0].title).toBe('Scene B');
  });
});

describe('StoreManager — Chapters', () => {
  it('saves chapter and reads/writes content from filesystem', () => {
    const project = store.createProject('Test', testDir);
    const chapter = store.saveChapter({
      id: '', projectId: project.id, number: 1, title: 'Chapter 1',
      status: 'pending', contentPath: 'chapters/001.md',
      createdAt: '', updatedAt: '',
    });
    store.saveChapterContent(chapter.id, '# Chapter 1\n\nContent here.');
    const content = store.getChapterContent(chapter.id);
    expect(content).toContain('Content here.');
  });
});

describe('StoreManager — Outline', () => {
  it('reads and writes canonical outline path under 大纲/arc-1.md', () => {
    store.saveOutlineContent('# arc-1');
    const canonicalPath = join(testDir, '大纲', 'arc-1.md');

    expect(existsSync(canonicalPath)).toBe(true);
    expect(readFileSync(canonicalPath, 'utf-8')).toBe('# arc-1');
    expect(store.getOutlineContent()).toBe('# arc-1');
  });

  it('migrates legacy root outline.md into canonical path on startup when needed', () => {
    store.close();
    writeFileSync(join(testDir, 'outline.md'), '# legacy outline', 'utf-8');

    store = new StoreManager(testDir);

    const canonicalPath = join(testDir, '大纲', 'arc-1.md');
    expect(readFileSync(canonicalPath, 'utf-8')).toBe('# legacy outline');
    expect(store.getOutlineContent()).toBe('# legacy outline');
  });
});
