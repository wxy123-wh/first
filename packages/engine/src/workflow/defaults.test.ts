import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { StoreManager } from '../store/store-manager.js';
import { AgentRegistry } from '../agent/registry.js';
import { ensureDefaultWorkflows, inferWorkflowKind } from './defaults.js';
import { rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let store: StoreManager;
let registry: AgentRegistry;
let testDir: string;

beforeEach(() => {
  testDir = join(tmpdir(), 'lisan-workflow-defaults-' + Date.now());
  mkdirSync(testDir, { recursive: true });
  store = new StoreManager(testDir);
  registry = new AgentRegistry(store);
  registry.seedBuiltins();
});

afterEach(() => {
  store.close();
  rmSync(testDir, { recursive: true, force: true });
});

describe('workflow defaults', () => {
  it('creates scene + chapter default workflows when project has none', () => {
    const project = store.createProject('Test', testDir);
    const result = ensureDefaultWorkflows(store, project.id, registry.list());
    expect(result).toHaveLength(2);

    const scene = result.find((workflow) => inferWorkflowKind(workflow) === 'scene');
    const chapter = result.find((workflow) => inferWorkflowKind(workflow) === 'chapter');

    expect(scene).toBeDefined();
    expect(chapter).toBeDefined();
    expect(scene!.kind).toBe('scene');
    expect(chapter!.kind).toBe('chapter');
    expect(scene!.steps.length).toBeGreaterThan(0);
    expect(chapter!.steps.length).toBeGreaterThan(0);
  });

  it('is idempotent and does not create duplicate default workflows', () => {
    const project = store.createProject('Test', testDir);

    ensureDefaultWorkflows(store, project.id, registry.list());
    ensureDefaultWorkflows(store, project.id, registry.list());
    const workflows = ensureDefaultWorkflows(store, project.id, registry.list());

    expect(workflows).toHaveLength(2);
    expect(workflows.filter((workflow) => inferWorkflowKind(workflow) === 'scene')).toHaveLength(1);
    expect(workflows.filter((workflow) => inferWorkflowKind(workflow) === 'chapter')).toHaveLength(1);
  });

  it('prefers explicit kind over name inference', () => {
    expect(
      inferWorkflowKind({
        name: '章节生成工作流',
        description: '',
        kind: 'scene',
        steps: [],
      }),
    ).toBe('scene');
  });
});
