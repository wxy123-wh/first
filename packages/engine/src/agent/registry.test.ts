import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AgentRegistry } from './registry.js';
import { StoreManager } from '../store/store-manager.js';
import { rmSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let store: StoreManager;
let registry: AgentRegistry;
let testDir: string;

beforeEach(() => {
  testDir = join(tmpdir(), 'lisan-agent-' + Date.now());
  mkdirSync(testDir, { recursive: true });
  store = new StoreManager(testDir);
  registry = new AgentRegistry(store);
});

afterEach(() => {
  store.close();
  rmSync(testDir, { recursive: true, force: true });
});

describe('AgentRegistry', () => {
  it('registers and retrieves a custom agent', () => {
    const agent = registry.register({
      name: 'Battle Polish',
      agentMd: '你专门润色战斗场景。\n- 增强打击感',
      provider: 'openai', model: 'gpt-4o', temperature: 0.8,
      promptTemplate: 'Polish: {{prev.output}}',
      inputSchema: ['prev.output'],
    });
    expect(agent.category).toBe('custom');
    const md = registry.getAgentMd(agent.id);
    expect(md).toContain('润色战斗场景');
  });

  it('lists all agents including builtin', () => {
    registry.seedBuiltins();
    const agents = registry.list();
    expect(agents.length).toBeGreaterThanOrEqual(12);
    expect(agents.some(a => a.category === 'builtin')).toBe(true);
  });

  it('seedBuiltins() seeds exactly 12 builtin agents', () => {
    registry.seedBuiltins();
    const builtins = registry.list().filter(a => a.category === 'builtin');
    expect(builtins).toHaveLength(12);
  });

  it('seedBuiltins() includes the 3 decompose agents', () => {
    registry.seedBuiltins();
    const names = registry.list().map(a => a.name);
    expect(names).toContain('拆解 Agent');
    expect(names).toContain('过渡 Agent');
    expect(names).toContain('检验 Agent');
  });

  it('seedBuiltins() is idempotent', () => {
    registry.seedBuiltins();
    registry.seedBuiltins();
    const builtins = registry.list().filter(a => a.category === 'builtin');
    expect(builtins).toHaveLength(12);
  });

  it('binds builtin agent model to provider model when updating provider', () => {
    registry.seedBuiltins();
    const builtin = registry.list().find(a => a.category === 'builtin')!;
    const updated = registry.update(builtin.id, {
      provider: 'newapi',
      model: 'gpt-4.1',
      temperature: 0.6,
    });
    const expectedModel = store.getProvider('newapi')?.model;
    expect(updated.provider).toBe('newapi');
    expect(updated.model).toBe(expectedModel);
    expect(updated.temperature).toBe(0.6);
  });

  it('duplicates a builtin agent as custom', () => {
    registry.seedBuiltins();
    const builtin = registry.list().find(a => a.category === 'builtin')!;
    const copy = registry.duplicate(builtin.id);
    expect(copy.category).toBe('custom');
    expect(copy.name).toContain('(副本)');
  });

  it('deletes a custom agent', () => {
    const agent = registry.register({
      name: 'Temp Agent',
      agentMd: 'temp',
      provider: 'openai', model: 'gpt-4o', temperature: 0.7,
      promptTemplate: '{{prev.output}}',
      inputSchema: ['prev.output'],
    });
    registry.delete(agent.id);
    expect(registry.list()).toHaveLength(0);
  });

  it('prevents deleting builtin agents', () => {
    registry.seedBuiltins();
    const builtin = registry.list().find(a => a.category === 'builtin')!;
    expect(() => registry.delete(builtin.id)).toThrow('Cannot delete builtin agent');
  });

  it('prevents overwriting builtin agent markdown', () => {
    registry.seedBuiltins();
    const builtin = registry.list().find(a => a.category === 'builtin')!;
    const original = registry.getAgentMd(builtin.id);
    expect(() => registry.saveAgentMd(builtin.id, '# hacked')).toThrow(
      'Cannot overwrite builtin agent markdown',
    );
    expect(registry.getAgentMd(builtin.id)).toBe(original);
  });

  it('allows overwriting custom agent markdown', () => {
    const custom = registry.register({
      name: 'Markdown Agent',
      agentMd: 'before',
      provider: 'openai',
      model: 'gpt-4o',
      temperature: 0.7,
      promptTemplate: '{{prev.output}}',
      inputSchema: ['prev.output'],
    });
    registry.saveAgentMd(custom.id, 'after');
    expect(registry.getAgentMd(custom.id)).toBe('after');
  });

  it('updates a custom agent', () => {
    const agent = registry.register({
      name: 'My Agent',
      agentMd: 'original',
      provider: 'openai', model: 'gpt-4o', temperature: 0.7,
      promptTemplate: '{{prev.output}}',
      inputSchema: ['prev.output'],
    });
    const updated = registry.update(agent.id, { name: 'Renamed Agent', temperature: 0.9 });
    expect(updated.name).toBe('Renamed Agent');
    expect(updated.temperature).toBe(0.9);
  });

  it('seedBuiltins() removes duplicated builtin agents', () => {
    registry.seedBuiltins();
    const contextAgent = registry
      .list()
      .find((agent) => agent.category === 'builtin' && agent.name === 'Context Agent')!;

    store.saveAgent({
      ...contextAgent,
      id: '',
      createdAt: '',
      updatedAt: '',
    });

    const before = registry.list().filter((agent) => agent.category === 'builtin');
    expect(before.length).toBe(13);

    registry.seedBuiltins();

    const after = registry.list().filter((agent) => agent.category === 'builtin');
    expect(after.length).toBe(12);
  });

  it('seedBuiltins() writes default introductions for builtin agent.md', () => {
    registry.seedBuiltins();
    const builtins = registry.list().filter((agent) => agent.category === 'builtin');
    expect(builtins.length).toBe(12);

    for (const builtin of builtins) {
      const md = registry.getAgentMd(builtin.id).trim();
      expect(md).not.toBe(`# ${builtin.name}`);
      expect(md.length).toBeGreaterThan(builtin.name.length + 4);
    }
  });

  it('seedBuiltins() loads decompose builtin markdown from preset file', () => {
    registry.seedBuiltins();
    const decompose = registry
      .list()
      .find((agent) => agent.category === 'builtin' && agent.name === '拆解 Agent');
    expect(decompose).toBeDefined();

    const seededMd = registry.getAgentMd(decompose!.id).trim();
    const presetMd = readFileSync(new URL('./presets/decompose-agent/agent.md', import.meta.url), 'utf-8').trim();
    expect(seededMd).toBe(presetMd);
  });
});
