# Lisan 桌面化全栈改造 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite Lisan from a CLI-driven tool into a desktop-first visual control center where authors can visually orchestrate workflows, create agents, edit scene cards, and read chapters.

**Architecture:** Four-layer system — React/Tauri desktop → Node.js sidecar (JSON-RPC over stdio) → @lisan/engine (Workflow Runtime + Agent Registry + Store Manager) → @lisan/llm + @lisan/rag. SQLite for structured data, filesystem for content. Linear workflow orchestration with event-driven UI updates.

**Tech Stack:** TypeScript 5, Node.js 22+, Tauri 2, React 19, React Router 7, Tailwind CSS 4, shadcn/ui, Zustand, SQLite (better-sqlite3), Vercel AI SDK, tsup, pnpm workspace, vitest

**Spec:** `docs/superpowers/specs/2026-03-20-desktop-transformation-design.md`

---

## Chunk 1: @lisan/engine — Store Manager + Types

Foundation layer. All other engine modules depend on Store Manager for data access.

### Task 1: Scaffold @lisan/engine package

**Files:**
- Create: `packages/engine/package.json`
- Create: `packages/engine/tsconfig.json`
- Create: `packages/engine/tsup.config.ts`
- Create: `packages/engine/src/index.ts`
- Modify: `pnpm-workspace.yaml` (already includes `packages/*`)

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@lisan/engine",
  "version": "0.1.0",
  "type": "module",
  "exports": {
    ".": { "import": "./dist/index.js", "require": "./dist/index.cjs" }
  },
  "scripts": {
    "build": "tsup",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "better-sqlite3": "^11.9.1",
    "nanoid": "^5.1.5",
    "@lisan/llm": "workspace:*",
    "@lisan/rag": "workspace:*"
  },
  "devDependencies": {
    "tsup": "^8.5.0",
    "vitest": "^4.1.0",
    "@types/better-sqlite3": "^7.6.13",
    "typescript": "^5.8.3"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

Copy from `packages/core/tsconfig.json`, adjust paths.

- [ ] **Step 3: Create tsup.config.ts**

```typescript
import { defineConfig } from 'tsup';
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
});
```

- [ ] **Step 4: Create empty src/index.ts**

```typescript
// @lisan/engine — core engine for Lisan desktop
export {};
```

- [ ] **Step 5: Install dependencies and verify build**

Run: `cd packages/engine && pnpm install && pnpm build`
Expected: Build succeeds with empty output

- [ ] **Step 6: Commit**

```bash
git add packages/engine
git commit -m "feat(engine): scaffold @lisan/engine package"
```

### Task 2: Define core types

**Files:**
- Create: `packages/engine/src/types.ts`

- [ ] **Step 1: Write type definitions**

```typescript
// packages/engine/src/types.ts

// === Project ===
export interface Project {
  id: string;
  name: string;
  basePath: string;
  sceneTagTemplate: TagTemplateEntry[];
  createdAt: string;
}

export interface TagTemplateEntry {
  key: string;
  label: string;
  options?: string[];
}

// === Workflow ===
export interface WorkflowDefinition {
  id: string;
  projectId: string;
  name: string;
  description: string;
  steps: WorkflowStep[];
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowStep {
  id: string;
  order: number;
  agentId: string;
  enabled: boolean;
  config?: StepConfigOverride;
}

export interface StepConfigOverride {
  temperature?: number;
  maxTokens?: number;
  model?: string;
  provider?: string;
}

// === Agent ===
export interface AgentDefinition {
  id: string;
  name: string;
  category: 'builtin' | 'custom';
  provider: string;
  model: string;
  temperature: number;
  maxTokens?: number;
  agentMdPath: string;
  promptTemplate: string;
  inputSchema: string[];
  createdAt: string;
  updatedAt: string;
}

// === Scene ===
export interface SceneCard {
  id: string;
  projectId: string;
  chapterId?: string;
  parentId?: string;
  order: number;
  title: string;
  characters: string[];
  location: string;
  eventSkeleton: string[];
  tags: Record<string, string>;
  sourceOutline: string;
  createdAt: string;
  updatedAt: string;
}

// === Chapter ===
export type ChapterStatus = 'pending' | 'drafting' | 'rewriting' | 'reviewing' | 'done';

export interface Chapter {
  id: string;
  projectId: string;
  number: number;
  title: string;
  status: ChapterStatus;
  workflowId?: string;
  contentPath: string;
  createdAt: string;
  updatedAt: string;
}

// === Execution ===
export type ExecutionStatus = 'pending' | 'running' | 'completed' | 'failed';
export type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export interface Execution {
  id: string;
  projectId: string;
  chapterId?: string;
  workflowId: string;
  status: ExecutionStatus;
  startedAt: string;
  completedAt?: string;
}

export interface ExecutionStep {
  id: string;
  executionId: string;
  stepId: string;
  agentId: string;
  status: StepStatus;
  input?: string;
  output?: string;
  tokens?: number;
  duration?: number;
  order: number;
}

// === Entity ===
export interface Entity {
  id: string;
  projectId: string;
  type: 'character' | 'location' | 'item' | 'event';
  name: string;
  data: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}
```

- [ ] **Step 2: Export from index.ts**

```typescript
export * from './types.js';
```

- [ ] **Step 3: Build to verify types compile**

Run: `cd packages/engine && pnpm build`
Expected: Build succeeds, dist/index.d.ts contains all type exports

- [ ] **Step 4: Commit**

```bash
git add packages/engine/src/types.ts packages/engine/src/index.ts
git commit -m "feat(engine): define core type interfaces"
```

### Task 3: Implement Store Manager — Database layer

**Files:**
- Create: `packages/engine/src/store/database.ts`
- Create: `packages/engine/src/store/database.test.ts`

- [ ] **Step 1: Write failing test for database initialization**

```typescript
// packages/engine/src/store/database.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { Database } from './database.js';
import { existsSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const testDir = join(tmpdir(), 'lisan-test-' + Date.now());

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe('Database', () => {
  it('creates .lisan directory and lisan.db on init', () => {
    mkdirSync(testDir, { recursive: true });
    const db = new Database(testDir);
    expect(existsSync(join(testDir, '.lisan', 'lisan.db'))).toBe(true);
    db.close();
  });

  it('creates all required tables', () => {
    mkdirSync(testDir, { recursive: true });
    const db = new Database(testDir);
    const tables = db.raw.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).all().map((r: any) => r.name);
    expect(tables).toContain('projects');
    expect(tables).toContain('workflows');
    expect(tables).toContain('workflow_steps');
    expect(tables).toContain('agents');
    expect(tables).toContain('scenes');
    expect(tables).toContain('chapters');
    expect(tables).toContain('executions');
    expect(tables).toContain('execution_steps');
    expect(tables).toContain('entities');
    db.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/engine && pnpm test -- src/store/database.test.ts`
Expected: FAIL — Database module not found

- [ ] **Step 3: Implement Database class**

```typescript
// packages/engine/src/store/database.ts
import BetterSqlite3 from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

export class Database {
  readonly raw: BetterSqlite3.Database;

  constructor(projectPath: string) {
    const lisanDir = join(projectPath, '.lisan');
    mkdirSync(lisanDir, { recursive: true });
    this.raw = new BetterSqlite3(join(lisanDir, 'lisan.db'));
    this.raw.pragma('journal_mode = WAL');
    this.raw.pragma('foreign_keys = ON');
    this.migrate();
  }

  private migrate(): void {
    this.raw.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        basePath TEXT NOT NULL,
        sceneTagTemplate TEXT DEFAULT '[]',
        createdAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS workflows (
        id TEXT PRIMARY KEY,
        projectId TEXT NOT NULL REFERENCES projects(id),
        name TEXT NOT NULL,
        description TEXT DEFAULT '',
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS workflow_steps (
        id TEXT PRIMARY KEY,
        workflowId TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
        "order" INTEGER NOT NULL,
        agentId TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        config TEXT DEFAULT '{}'
      );

      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        projectId TEXT REFERENCES projects(id),
        name TEXT NOT NULL,
        category TEXT NOT NULL CHECK(category IN ('builtin', 'custom')),
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        temperature REAL NOT NULL DEFAULT 0.7,
        maxTokens INTEGER,
        agentMdPath TEXT NOT NULL,
        promptTemplate TEXT NOT NULL DEFAULT '',
        inputSchema TEXT DEFAULT '[]',
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS scenes (
        id TEXT PRIMARY KEY,
        projectId TEXT NOT NULL REFERENCES projects(id),
        chapterId TEXT REFERENCES chapters(id),
        parentId TEXT REFERENCES scenes(id),
        "order" INTEGER NOT NULL,
        title TEXT NOT NULL,
        characters TEXT DEFAULT '[]',
        location TEXT DEFAULT '',
        eventSkeleton TEXT DEFAULT '[]',
        tags TEXT DEFAULT '{}',
        sourceOutline TEXT DEFAULT '',
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS chapters (
        id TEXT PRIMARY KEY,
        projectId TEXT NOT NULL REFERENCES projects(id),
        number INTEGER NOT NULL,
        title TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        workflowId TEXT REFERENCES workflows(id),
        contentPath TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS executions (
        id TEXT PRIMARY KEY,
        projectId TEXT NOT NULL REFERENCES projects(id),
        chapterId TEXT REFERENCES chapters(id),
        workflowId TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        startedAt TEXT NOT NULL,
        completedAt TEXT
      );

      CREATE TABLE IF NOT EXISTS execution_steps (
        id TEXT PRIMARY KEY,
        executionId TEXT NOT NULL REFERENCES executions(id) ON DELETE CASCADE,
        stepId TEXT NOT NULL,
        agentId TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        input TEXT,
        output TEXT,
        tokens INTEGER,
        duration INTEGER,
        "order" INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS entities (
        id TEXT PRIMARY KEY,
        projectId TEXT NOT NULL REFERENCES projects(id),
        type TEXT NOT NULL CHECK(type IN ('character', 'location', 'item', 'event')),
        name TEXT NOT NULL,
        data TEXT DEFAULT '{}',
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );
    `);
  }

  close(): void {
    this.raw.close();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/engine && pnpm test -- src/store/database.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/store/
git commit -m "feat(engine): implement SQLite database with schema migration"
```

### Task 4: Implement Store Manager — CRUD operations

**Files:**
- Create: `packages/engine/src/store/store-manager.ts`
- Create: `packages/engine/src/store/store-manager.test.ts`
- Create: `packages/engine/src/store/index.ts`

- [ ] **Step 1: Write failing tests for project + workflow CRUD**

```typescript
// packages/engine/src/store/store-manager.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { StoreManager } from './store-manager.js';
import { rmSync, mkdirSync } from 'node:fs';
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
      description: 'Standard', steps: [
        { id: '', order: 0, agentId: 'agent-1', enabled: true },
        { id: '', order: 1, agentId: 'agent-2', enabled: true },
      ], createdAt: '', updatedAt: '',
    });
    const workflows = store.getWorkflows(project.id);
    expect(workflows).toHaveLength(1);
    expect(workflows[0].steps).toHaveLength(2);
    expect(workflows[0].steps[0].agentId).toBe('agent-1');
  });

  it('deletes workflow and cascades to steps', () => {
    const project = store.createProject('Test', testDir);
    const workflow = store.saveWorkflow({
      id: '', projectId: project.id, name: 'Flow',
      description: '', steps: [
        { id: '', order: 0, agentId: 'a1', enabled: true },
      ], createdAt: '', updatedAt: '',
    });
    store.deleteWorkflow(workflow.id);
    expect(store.getWorkflows(project.id)).toHaveLength(0);
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/engine && pnpm test -- src/store/store-manager.test.ts`
Expected: FAIL — StoreManager not found

- [ ] **Step 3: Implement StoreManager**

Create `packages/engine/src/store/store-manager.ts` implementing all CRUD methods:
- `createProject`, `getProject`
- `saveWorkflow`, `getWorkflows`, `deleteWorkflow` (with steps join)
- `saveAgent`, `getAgents`, `deleteAgent`, `getAgentMd`, `saveAgentMd`
- `saveScene`, `getScenes`, `deleteScene`, `reorderScenes`
- `saveChapter`, `getChapters`, `getChapterContent`, `saveChapterContent`
- `saveExecution`, `getExecutions`, `getExecutionDetail`
- `queryEntities`

Each method uses the Database class for SQLite operations. Chapter content and agent.md use filesystem (readFileSync/writeFileSync relative to project basePath). IDs generated with `nanoid()`. Timestamps with `new Date().toISOString()`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/engine && pnpm test -- src/store/store-manager.test.ts`
Expected: PASS

- [ ] **Step 5: Create store/index.ts barrel export**

```typescript
export { Database } from './database.js';
export { StoreManager } from './store-manager.js';
```

- [ ] **Step 6: Commit**

```bash
git add packages/engine/src/store/
git commit -m "feat(engine): implement StoreManager with full CRUD operations"
```

## Chunk 2: @lisan/engine — Agent Registry + Template Engine

### Task 5: Implement template engine

**Files:**
- Create: `packages/engine/src/template/engine.ts`
- Create: `packages/engine/src/template/engine.test.ts`

- [ ] **Step 1: Write failing tests for template variable injection**

```typescript
// packages/engine/src/template/engine.test.ts
import { describe, it, expect } from 'vitest';
import { renderTemplate } from './engine.js';

describe('renderTemplate', () => {
  it('replaces simple variables', () => {
    const result = renderTemplate('Hello {{name}}', { name: 'World' });
    expect(result).toBe('Hello World');
  });

  it('replaces nested variables', () => {
    const result = renderTemplate('{{context.chapter}}', {
      context: { chapter: 'Chapter 1' },
    });
    expect(result).toBe('Chapter 1');
  });

  it('replaces prev.output', () => {
    const result = renderTemplate('Previous: {{prev.output}}', {
      prev: { output: 'draft text' },
    });
    expect(result).toBe('Previous: draft text');
  });

  it('replaces step.<id>.output', () => {
    const result = renderTemplate('From step: {{step.abc.output}}', {
      step: { abc: { output: 'step output' } },
    });
    expect(result).toBe('From step: step output');
  });

  it('serializes objects/arrays as JSON', () => {
    const result = renderTemplate('Scenes: {{context.scenes}}', {
      context: { scenes: [{ title: 'A' }] },
    });
    expect(result).toContain('"title"');
  });

  it('leaves unresolved variables as-is', () => {
    const result = renderTemplate('{{missing}}', {});
    expect(result).toBe('{{missing}}');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/engine && pnpm test -- src/template/engine.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement renderTemplate**

```typescript
// packages/engine/src/template/engine.ts
export function renderTemplate(
  template: string,
  context: Record<string, unknown>,
): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (match, path: string) => {
    const keys = path.trim().split('.');
    let value: unknown = context;
    for (const key of keys) {
      if (value == null || typeof value !== 'object') return match;
      value = (value as Record<string, unknown>)[key];
    }
    if (value === undefined) return match;
    if (typeof value === 'string') return value;
    return JSON.stringify(value, null, 2);
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/engine && pnpm test -- src/template/engine.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/template/
git commit -m "feat(engine): implement template variable injection engine"
```

### Task 6: Implement Agent Registry

**Files:**
- Create: `packages/engine/src/agent/registry.ts`
- Create: `packages/engine/src/agent/registry.test.ts`
- Create: `packages/engine/src/agent/executor.ts`
- Create: `packages/engine/src/agent/executor.test.ts`

- [ ] **Step 1: Write failing tests for AgentRegistry**

```typescript
// packages/engine/src/agent/registry.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AgentRegistry } from './registry.js';
import { StoreManager } from '../store/store-manager.js';
import { rmSync, mkdirSync } from 'node:fs';
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
    expect(agents.length).toBeGreaterThanOrEqual(9);
    expect(agents.some(a => a.category === 'builtin')).toBe(true);
  });

  it('prevents editing builtin agents', () => {
    registry.seedBuiltins();
    const builtin = registry.list().find(a => a.category === 'builtin')!;
    expect(() => registry.update(builtin.id, { name: 'Hacked' }))
      .toThrow('Cannot edit builtin agent');
  });

  it('duplicates a builtin agent as custom', () => {
    registry.seedBuiltins();
    const builtin = registry.list().find(a => a.category === 'builtin')!;
    const copy = registry.duplicate(builtin.id);
    expect(copy.category).toBe('custom');
    expect(copy.name).toContain('(副本)');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/engine && pnpm test -- src/agent/registry.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement AgentRegistry**

`AgentRegistry` wraps `StoreManager` agent methods and adds:
- `register(opts)` — creates custom agent, writes agent.md to filesystem
- `seedBuiltins()` — inserts 9 builtin presets (migrated from webnovel plugin)
- `list(projectId?)` — returns all agents
- `update(id, patch)` — throws if builtin
- `duplicate(id)` — copies agent as custom with "(副本)" suffix
- `getAgentMd(id)` — reads agent.md from filesystem
- `delete(id)` — throws if builtin

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/engine && pnpm test -- src/agent/registry.test.ts`
Expected: PASS

- [ ] **Step 5: Write failing tests for AgentExecutor**

```typescript
// packages/engine/src/agent/executor.test.ts
import { describe, it, expect, vi } from 'vitest';
import { AgentExecutor } from './executor.js';

describe('AgentExecutor', () => {
  it('calls LLM with system (agent.md) and user (rendered template)', async () => {
    const mockProvider = {
      generate: vi.fn().mockResolvedValue({
        text: 'Generated chapter content',
        usage: { totalTokens: 500 },
      }),
    };
    const executor = new AgentExecutor(mockProvider as any);
    const result = await executor.execute({
      agentMd: 'You are a draft writer.',
      promptTemplate: 'Write based on: {{context.scenes}}',
      context: { context: { scenes: 'Scene A: Fight' } },
    });
    expect(result.text).toBe('Generated chapter content');
    expect(mockProvider.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        system: 'You are a draft writer.',
        prompt: 'Write based on: Scene A: Fight',
      })
    );
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd packages/engine && pnpm test -- src/agent/executor.test.ts`
Expected: FAIL

- [ ] **Step 7: Implement AgentExecutor**

```typescript
// packages/engine/src/agent/executor.ts
import { renderTemplate } from '../template/engine.js';
import type { LLMProvider } from '@lisan/llm';

export interface ExecuteOptions {
  agentMd: string;
  promptTemplate: string;
  context: Record<string, unknown>;
  temperature?: number;
  maxTokens?: number;
  model?: string;
}

export interface ExecuteResult {
  text: string;
  tokens: number;
  duration: number;
}

export class AgentExecutor {
  constructor(private provider: LLMProvider) {}

  async execute(opts: ExecuteOptions): Promise<ExecuteResult> {
    const prompt = renderTemplate(opts.promptTemplate, opts.context);
    const start = Date.now();
    const result = await this.provider.generate({
      system: opts.agentMd,
      prompt,
      temperature: opts.temperature,
      maxTokens: opts.maxTokens,
      model: opts.model,
    });
    return {
      text: result.text,
      tokens: result.usage?.totalTokens ?? 0,
      duration: Date.now() - start,
    };
  }
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd packages/engine && pnpm test -- src/agent/executor.test.ts`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add packages/engine/src/agent/
git commit -m "feat(engine): implement AgentRegistry and AgentExecutor"
```

## Chunk 3: @lisan/engine — Workflow Runtime

### Task 7: Implement Workflow Runtime — event emitter + linear execution

**Files:**
- Create: `packages/engine/src/workflow/runtime.ts`
- Create: `packages/engine/src/workflow/runtime.test.ts`
- Create: `packages/engine/src/workflow/events.ts`

- [ ] **Step 1: Define workflow event types**

```typescript
// packages/engine/src/workflow/events.ts
export type WorkflowEvent =
  | { type: 'workflow:start'; workflowId: string; chapterId?: string }
  | { type: 'step:start'; stepId: string; agentId: string }
  | { type: 'step:progress'; stepId: string; chunk: string }
  | { type: 'step:complete'; stepId: string; output: string; tokens: number; duration: number }
  | { type: 'step:failed'; stepId: string; error: string }
  | { type: 'workflow:complete'; chapterId?: string; summary: string };

export type WorkflowEventHandler = (event: WorkflowEvent) => void;
```

- [ ] **Step 2: Write failing tests for WorkflowRuntime**

Test cases:
- Executes steps in order, emitting start/complete events for each
- Skips disabled steps (enabled: false)
- Handles `pause` command — stops after current step
- Handles `resume` command — continues from paused step
- Handles `abort` command — terminates with failed status
- Handles `skip` command — marks step as skipped, moves to next
- Handles `rerun` command — clears target step + subsequent outputs, re-executes from target
- Persists execution state to StoreManager after each step

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd packages/engine && pnpm test -- src/workflow/runtime.test.ts`
Expected: FAIL

- [ ] **Step 4: Implement WorkflowRuntime**

```typescript
// packages/engine/src/workflow/runtime.ts (key structure)
export class WorkflowRuntime {
  private paused = false;
  private aborted = false;
  private handlers: WorkflowEventHandler[] = [];

  constructor(
    private store: StoreManager,
    private agentRegistry: AgentRegistry,
    private agentExecutor: AgentExecutor,
  ) {}

  on(handler: WorkflowEventHandler): void { ... }

  async run(workflowId: string, globalContext: Record<string, unknown>): Promise<void> {
    // 1. Load workflow + steps from store
    // 2. Create execution record
    // 3. For each enabled step in order:
    //    a. Check paused/aborted flags
    //    b. Emit step:start
    //    c. Load agent definition + agent.md
    //    d. Build step context (prev.output, step.<id>.output, global context)
    //    e. Execute via AgentExecutor
    //    f. Emit step:complete
    //    g. Persist execution_step to store
    // 4. Emit workflow:complete
  }

  pause(): void { this.paused = true; }
  resume(): void { this.paused = false; /* notify waiting loop */ }
  abort(): void { this.aborted = true; }
  skip(stepId: string): void { ... }
  rerun(stepId: string): void { ... }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/engine && pnpm test -- src/workflow/runtime.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/engine/src/workflow/
git commit -m "feat(engine): implement WorkflowRuntime with event-driven execution"
```

### Task 8: Implement context binding

**Files:**
- Create: `packages/engine/src/workflow/context-builder.ts`
- Create: `packages/engine/src/workflow/context-builder.test.ts`

- [ ] **Step 1: Write failing tests**

Test cases:
- `buildChapterContext(chapterId)` — returns object with scenes, chapter, previousChapterTail, entities, outline
- `buildDecomposeContext(sourceOutline, projectId)` — returns object with sourceOutline, existingScenes, tagTemplate

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement ContextBuilder**

Reads from StoreManager to assemble the context object that gets injected into template variables.

- [ ] **Step 4: Run tests to verify they pass**

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/workflow/context-builder.ts packages/engine/src/workflow/context-builder.test.ts
git commit -m "feat(engine): implement context binding for chapter and decompose workflows"
```

### Task 9: Wire up engine entry point

**Files:**
- Create: `packages/engine/src/engine.ts`
- Modify: `packages/engine/src/index.ts`

- [ ] **Step 1: Create Engine facade class**

```typescript
// packages/engine/src/engine.ts
export class Engine {
  readonly store: StoreManager;
  readonly agents: AgentRegistry;
  readonly executor: AgentExecutor;
  readonly runtime: WorkflowRuntime;

  constructor(projectPath: string, llmProvider: LLMProvider) {
    this.store = new StoreManager(projectPath);
    this.agents = new AgentRegistry(this.store);
    this.executor = new AgentExecutor(llmProvider);
    this.runtime = new WorkflowRuntime(this.store, this.agents, this.executor);
  }

  close(): void { this.store.close(); }
}
```

- [ ] **Step 2: Update index.ts to export everything**

```typescript
export { Engine } from './engine.js';
export * from './types.js';
export { StoreManager } from './store/index.js';
export { AgentRegistry } from './agent/registry.js';
export { AgentExecutor } from './agent/executor.js';
export { WorkflowRuntime } from './workflow/runtime.js';
export type { WorkflowEvent } from './workflow/events.js';
```

- [ ] **Step 3: Build and verify**

Run: `cd packages/engine && pnpm build`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add packages/engine/src/engine.ts packages/engine/src/index.ts
git commit -m "feat(engine): add Engine facade and wire up all modules"
```

## Chunk 4: Sidecar — JSON-RPC communication layer

### Task 10: Implement JSON-RPC server

**Files:**
- Create: `packages/engine/src/sidecar/rpc-server.ts`
- Create: `packages/engine/src/sidecar/rpc-server.test.ts`
- Create: `packages/engine/src/sidecar/main.ts`

- [ ] **Step 1: Write failing tests for RPC message parsing and dispatch**

Test cases:
- Parses valid JSON-RPC request and dispatches to handler
- Returns JSON-RPC error for unknown method
- Returns JSON-RPC error for malformed request
- Sends Notification (no id) for events

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement RpcServer**

```typescript
// packages/engine/src/sidecar/rpc-server.ts
export class RpcServer {
  private handlers = new Map<string, (params: any) => Promise<any>>();

  register(method: string, handler: (params: any) => Promise<any>): void { ... }

  async handleMessage(raw: string): Promise<string | null> {
    // Parse JSON-RPC, dispatch to handler, return response
  }

  notify(method: string, params: Record<string, any>): string {
    // Return JSON-RPC notification string
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

- [ ] **Step 5: Implement sidecar main entry point**

```typescript
// packages/engine/src/sidecar/main.ts
// Reads stdin line-by-line, dispatches to RpcServer, writes responses to stdout
// Registers all RPC methods: project.open, workflow.*, agent.*, scene.*, chapter.*, execution.*, entity.*
// Forwards WorkflowRuntime events as JSON-RPC notifications
```

- [ ] **Step 6: Commit**

```bash
git add packages/engine/src/sidecar/
git commit -m "feat(engine): implement JSON-RPC sidecar server with all RPC methods"
```

### Task 11: Implement builtin agent presets

**Files:**
- Create: `packages/engine/src/agent/presets/` (9 agent.md files + preset definitions)

- [ ] **Step 1: Migrate 9 agent configs from webnovel plugin**

Extract from `plugins/webnovel/src/index.ts`:
- Each agent gets an `agent.md` file with the system prompt content
- Each agent gets a preset definition (provider, model, temperature, promptTemplate, inputSchema)

- [ ] **Step 2: Add 3 scene decomposition agent presets**

- `decompose-agent/agent.md` — 拆解 Agent
- `transition-agent/agent.md` — 过渡 Agent
- `validation-agent/agent.md` — 检验 Agent

- [ ] **Step 3: Update AgentRegistry.seedBuiltins() to load all 12 presets**

- [ ] **Step 4: Write test verifying all 12 presets load correctly**

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/agent/presets/
git commit -m "feat(engine): add 12 builtin agent presets (9 writing + 3 decompose)"
```

## Chunk 5: Tauri Sidecar Integration

### Task 12: Rewrite Tauri Rust backend for sidecar management

**Files:**
- Rewrite: `lisan-desktop/src-tauri/src/lib.rs`
- Rewrite: `lisan-desktop/src-tauri/src/state.rs`
- Create: `lisan-desktop/src-tauri/src/sidecar.rs`
- Rewrite: `lisan-desktop/src-tauri/src/commands/mod.rs`
- Delete: `lisan-desktop/src-tauri/src/commands/cli.rs` (replaced by sidecar)

- [ ] **Step 1: Implement sidecar process manager in Rust**

`sidecar.rs`:
- Spawns Node.js process running `packages/engine/dist/sidecar/main.js`
- Manages stdin/stdout pipes
- Sends JSON-RPC requests, receives responses
- Forwards notifications as Tauri events
- Auto-restarts on crash

- [ ] **Step 2: Implement Tauri commands as thin RPC wrappers**

Each Tauri `#[command]` simply forwards to sidecar via JSON-RPC:
- `project_open(path)` → `project.open`
- `workflow_list(project_id)` → `workflow.list`
- `workflow_save(workflow)` → `workflow.save`
- `workflow_run(workflow_id, chapter_id)` → `workflow.run`
- `workflow_pause/resume/skip/rerun/abort` → corresponding RPC
- `agent_list/save/delete/get_md/save_md` → agent.* RPC
- `scene_list/save/delete/reorder` → scene.* RPC
- `chapter_list/get_content/save_content` → chapter.* RPC
- `execution_list/detail` → execution.* RPC

- [ ] **Step 3: Update Tauri config for sidecar**

Update `tauri.conf.json` to bundle the Node.js sidecar binary.

- [ ] **Step 4: Test sidecar lifecycle manually**

Run: `cd lisan-desktop && pnpm tauri dev`
Expected: Sidecar starts, Tauri app launches, no errors in console

- [ ] **Step 5: Commit**

```bash
git add lisan-desktop/src-tauri/
git commit -m "feat(desktop): rewrite Tauri backend with sidecar JSON-RPC integration"
```

## Chunk 6: Desktop UI — Shell + Navigation

### Task 13: Rewrite React app shell with 6-tab layout

**Files:**
- Rewrite: `lisan-desktop/src/App.tsx`
- Create: `lisan-desktop/src/layouts/ProjectLayout.tsx`
- Create: `lisan-desktop/src/hooks/useSidecar.ts`
- Create: `lisan-desktop/src/hooks/useWorkflowEvents.ts`
- Rewrite: `lisan-desktop/src/lib/store.ts`

- [ ] **Step 1: Implement Zustand store for app state**

```typescript
// lisan-desktop/src/lib/store.ts
interface AppState {
  currentProject: Project | null;
  activeTab: 'outline' | 'scenes' | 'chapters' | 'workflows' | 'agents' | 'executions';
  setProject: (project: Project) => void;
  setActiveTab: (tab: AppState['activeTab']) => void;
}
```

- [ ] **Step 2: Implement useSidecar hook**

Wraps all Tauri invoke calls into typed async functions.

- [ ] **Step 3: Implement useWorkflowEvents hook**

Listens to Tauri events from sidecar notifications, updates Zustand store.

- [ ] **Step 4: Implement ProjectLayout with sidebar navigation**

6 tabs: 大纲, 场景, 章节, 工作流, 智能体, 执行. Sidebar + content area layout per spec section 8.1.

- [ ] **Step 5: Update App.tsx routing**

```
/ → ProjectsPage (list)
/projects/new → NewProjectPage
/projects/:id → ProjectLayout
  /projects/:id/outline → OutlinePage
  /projects/:id/scenes → ScenesPage
  /projects/:id/chapters → ChaptersPage
  /projects/:id/workflows → WorkflowsPage
  /projects/:id/agents → AgentsPage
  /projects/:id/executions → ExecutionsPage
```

- [ ] **Step 6: Commit**

```bash
git add lisan-desktop/src/
git commit -m "feat(desktop): implement app shell with 6-tab project layout"
```

## Chunk 7: Desktop UI — Tab Views

### Task 14: Implement Outline tab

**Files:**
- Create: `lisan-desktop/src/pages/OutlinePage.tsx`

- [ ] **Step 1: Implement markdown editor with right-click "拆解为场景" context menu**

Uses a textarea or markdown editor component. Reads/writes outline.md via sidecar. Right-click on selected text triggers scene decomposition workflow.

- [ ] **Step 2: Commit**

### Task 15: Implement Scenes tab

**Files:**
- Create: `lisan-desktop/src/pages/ScenesPage.tsx`
- Create: `lisan-desktop/src/components/SceneCard.tsx`
- Create: `lisan-desktop/src/components/SceneEditForm.tsx`

- [ ] **Step 1: Implement SceneCard component**

Displays: title, characters chips, location, eventSkeleton preview, custom tags. Click to expand into SceneEditForm.

- [ ] **Step 2: Implement SceneEditForm**

All fields editable. Custom tags rendered based on project's sceneTagTemplate (dropdown for options, text input otherwise).

- [ ] **Step 3: Implement ScenesPage**

Card grid layout. Chapter filter dropdown. "AI 生成场景" button. Sub-scenes shown indented under parent.

- [ ] **Step 4: Commit**

### Task 16: Implement Chapters tab

**Files:**
- Create: `lisan-desktop/src/pages/ChaptersPage.tsx`

- [ ] **Step 1: Implement chapter list + markdown reader/editor**

Left panel: chapter list with number, title, status badge. Right panel: markdown content viewer/editor. "运行" button to trigger workflow selection dialog.

- [ ] **Step 2: Commit**

### Task 17: Implement Workflows tab

**Files:**
- Create: `lisan-desktop/src/pages/WorkflowsPage.tsx`
- Create: `lisan-desktop/src/components/WorkflowStepCard.tsx`

- [ ] **Step 1: Implement workflow editor with drag-and-drop step list**

Workflow selector dropdown + "新建" button. Step list with drag-to-reorder (use @dnd-kit/sortable). Each step card shows agent name + agent.md first line. Toggle for enable/disable. Click to expand for StepConfigOverride.

- [ ] **Step 2: Implement add step dialog**

Select agent from registry to add as new step.

- [ ] **Step 3: Commit**

### Task 18: Implement Agents tab

**Files:**
- Create: `lisan-desktop/src/pages/AgentsPage.tsx`
- Create: `lisan-desktop/src/pages/AgentEditPage.tsx`

- [ ] **Step 1: Implement agent card grid**

Builtin agents: gray badge. Custom agents: blue badge. Each card shows name, model, first 2 lines of agent.md. "新建智能体" button.

- [ ] **Step 2: Implement AgentEditPage**

Top: agent.md markdown editor. Bottom: model selector (provider dropdown + model input + temperature slider), promptTemplate code editor with {{key}} highlighting, inputSchema tag input.

- [ ] **Step 3: Commit**

### Task 19: Implement Executions tab

**Files:**
- Create: `lisan-desktop/src/pages/ExecutionsPage.tsx`
- Create: `lisan-desktop/src/pages/ExecutionDetailPage.tsx` (rewrite existing)

- [ ] **Step 1: Implement execution history list**

Table: chapter, workflow name, status badge, started time, duration. Click to view detail.

- [ ] **Step 2: Implement execution detail with live streaming**

Step-by-step timeline. Each step shows agent name, status, input/output, tokens, duration. During execution: real-time LLM output streaming via workflow events. Control buttons: pause/resume/skip/abort.

- [ ] **Step 3: Commit**

## Chunk 8: Integration + Migration

### Task 20: Migrate truth system

**Files:**
- Create: `packages/engine/src/truth/truth-manager.ts`
- Create: `packages/engine/src/truth/types.ts`

- [ ] **Step 1: Copy and adapt truth system from @lisan/core**

Migrate `core/truth/truth-manager.ts` and `core/truth/types.ts`. Update to use StoreManager for file path resolution instead of direct filesystem access.

- [ ] **Step 2: Run existing truth tests adapted for new paths**

- [ ] **Step 3: Commit**

### Task 21: Migrate post-write checker

**Files:**
- Create: `packages/engine/src/checker/post-write-checker.ts`

- [ ] **Step 1: Copy and adapt checker from @lisan/core**

- [ ] **Step 2: Commit**

### Task 22: End-to-end integration test

**Files:**
- Create: `packages/engine/src/integration.test.ts`

- [ ] **Step 1: Write integration test**

Test the full flow:
1. Create Engine instance
2. Seed builtin agents
3. Create a project
4. Create a workflow with 2 steps (mock LLM provider)
5. Run workflow
6. Verify execution record in store
7. Verify events were emitted in correct order

- [ ] **Step 2: Run test**

Run: `cd packages/engine && pnpm test -- src/integration.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

### Task 23: Clean up deprecated packages

- [ ] **Step 1: Update root package.json scripts to exclude @lisan/cli and @lisan/plugin-webnovel from build**

- [ ] **Step 2: Add deprecation notices to @lisan/core, @lisan/cli, @lisan/plugin-webnovel package.json**

```json
{ "deprecated": "Replaced by @lisan/engine in v2.0" }
```

- [ ] **Step 3: Commit**

```bash
git commit -m "chore: deprecate @lisan/core, @lisan/cli, @lisan/plugin-webnovel"
```
