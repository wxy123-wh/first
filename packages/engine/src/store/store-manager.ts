import { nanoid } from 'nanoid';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { Database } from './database.js';
import { CredentialVault } from './credential-vault.js';
import type {
  Project, TagTemplateEntry, WorkflowDefinition, WorkflowStep,
  AgentDefinition, SceneCard, Chapter, ChapterStatus,
  Execution, ExecutionStatus, ExecutionStep, StepStatus, Entity, ProviderDefinition, ProviderType, WorkflowKind,
} from '../types.js';

const DEFAULT_PROVIDERS: Array<Pick<ProviderDefinition, 'id' | 'name' | 'type' | 'model'>> = [
  { id: 'openai', name: 'OpenAI', type: 'openai', model: 'gpt-4o' },
  { id: 'anthropic', name: 'Anthropic', type: 'anthropic', model: 'claude-opus-4-6' },
  { id: 'newapi', name: 'NewAPI', type: 'newapi', model: 'gpt-4o' },
];

function defaultModelForType(type: ProviderType): string {
  switch (type) {
    case 'anthropic':
      return 'claude-opus-4-6';
    case 'openai':
      return 'gpt-4o';
    case 'newapi':
      return 'gpt-4o';
    default:
      return 'gpt-4o';
  }
}

const CANONICAL_OUTLINE_RELATIVE_PATH = join('大纲', 'arc-1.md');
const LEGACY_OUTLINE_RELATIVE_PATH = 'outline.md';
const ROOT_CONFIG_RELATIVE_PATH = 'lisan.config.yaml';
const LEGACY_CONFIG_RELATIVE_PATH = join('.lisan', 'config.yaml');

const SCENE_NAME_HINT = /场景|拆解|decompose/i;
const CHAPTER_NAME_HINT = /章节|写作|起草|改写|润色|生成|draft|rewrite|review/i;
const SCENE_AGENT_HINT = /拆解|过渡|检验|decompose|transition|validation/i;
const CHAPTER_AGENT_HINT = /context|起草|体验植入|爽点强化|节奏张力|对话博弈|anti-ai|终审|data/i;

type LlmRole = 'orchestrator' | 'worker';

interface ParsedProviderModelSelection {
  role: LlmRole;
  provider: ProviderType;
  model: string;
}

export class StoreManager {
  private db: Database;
  private basePath: string;
  private credentials: CredentialVault;
  private canonicalOutlinePath: string;
  private legacyOutlinePath: string;

  constructor(projectPath: string) {
    this.basePath = projectPath;
    this.db = new Database(projectPath);
    this.credentials = new CredentialVault(projectPath);
    this.canonicalOutlinePath = join(this.basePath, CANONICAL_OUTLINE_RELATIVE_PATH);
    this.legacyOutlinePath = join(this.basePath, LEGACY_OUTLINE_RELATIVE_PATH);
    this.seedProviders();
    this.migrateLegacyProviderApiKeys();
    this.migrateLegacyOutlinePath();
    this.bootstrapProvidersFromProjectConfig();
    this.backfillWorkflowKinds();
  }

  getWorkspacePath(): string {
    return this.basePath;
  }

  resolveWorkspacePath(...segments: string[]): string {
    return join(this.basePath, ...segments);
  }

  resolveProjectPath(projectId: string, ...segments: string[]): string {
    const project = this.getProject(projectId);
    return join(project.basePath, ...segments);
  }

  // === Projects ===

  createProject(name: string, basePath: string): Project {
    const id = nanoid();
    const now = new Date().toISOString();
    this.db.raw.prepare(
      'INSERT INTO projects (id, name, basePath, sceneTagTemplate, createdAt) VALUES (?, ?, ?, ?, ?)'
    ).run(id, name, basePath, '[]', now);
    return { id, name, basePath, sceneTagTemplate: [], createdAt: now };
  }

  getProjectByBasePath(basePath: string): Project | null {
    const row = this.db.raw.prepare('SELECT * FROM projects WHERE basePath = ?').get(basePath) as any;
    if (!row) {
      return null;
    }
    return {
      ...row,
      sceneTagTemplate: JSON.parse(row.sceneTagTemplate) as TagTemplateEntry[],
    };
  }

  ensureProject(name: string, basePath: string): Project {
    const existing = this.getProjectByBasePath(basePath);
    if (existing) {
      return existing;
    }
    return this.createProject(name, basePath);
  }

  getProject(id: string): Project {
    const row = this.db.raw.prepare('SELECT * FROM projects WHERE id = ?').get(id) as any;
    if (!row) throw new Error(`Project not found: ${id}`);
    return {
      ...row,
      sceneTagTemplate: JSON.parse(row.sceneTagTemplate) as TagTemplateEntry[],
    };
  }

  updateProject(id: string, patch: Partial<Pick<Project, 'name' | 'sceneTagTemplate'>>): Project {
    const project = this.getProject(id);
    const name = patch.name ?? project.name;
    const sceneTagTemplate = patch.sceneTagTemplate ?? project.sceneTagTemplate;
    this.db.raw.prepare(
      'UPDATE projects SET name = ?, sceneTagTemplate = ? WHERE id = ?'
    ).run(name, JSON.stringify(sceneTagTemplate), id);
    return { ...project, name, sceneTagTemplate };
  }

  // === Providers ===

  private normalizeYamlScalar(value: string): string {
    const trimmed = value.trim();
    if (!trimmed) {
      return '';
    }
    const quote = trimmed[0];
    if ((quote === '"' || quote === "'") && trimmed.endsWith(quote)) {
      return trimmed.slice(1, -1).trim();
    }
    const commentIndex = trimmed.indexOf(' #');
    return (commentIndex === -1 ? trimmed : trimmed.slice(0, commentIndex)).trim();
  }

  private normalizeProviderType(value: string): ProviderType | null {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'openai' || normalized === 'anthropic' || normalized === 'newapi') {
      return normalized;
    }
    return null;
  }

  private readProjectConfigContent(): string | null {
    const candidates = [ROOT_CONFIG_RELATIVE_PATH, LEGACY_CONFIG_RELATIVE_PATH];
    for (const relativePath of candidates) {
      const fullPath = join(this.basePath, relativePath);
      if (!existsSync(fullPath)) {
        continue;
      }
      try {
        return readFileSync(fullPath, 'utf-8');
      } catch {
        continue;
      }
    }
    return null;
  }

  private parseLlmProviderSelections(configContent: string): ParsedProviderModelSelection[] {
    const lines = configContent.split(/\r?\n/);
    let inLlmSection = false;
    let llmIndent = -1;
    let currentRole: LlmRole | null = null;
    let roleIndent = -1;
    const parsedByRole: Partial<Record<LlmRole, Partial<Pick<ParsedProviderModelSelection, 'provider' | 'model'>>>> =
      {};

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }
      const indent = line.length - line.trimStart().length;

      if (!inLlmSection) {
        if (trimmed === 'llm:' || trimmed.startsWith('llm:')) {
          inLlmSection = true;
          llmIndent = indent;
          currentRole = null;
          roleIndent = -1;
        }
        continue;
      }

      if (indent <= llmIndent) {
        inLlmSection = false;
        currentRole = null;
        roleIndent = -1;
        continue;
      }

      if (trimmed === 'orchestrator:' || trimmed.startsWith('orchestrator:')) {
        currentRole = 'orchestrator';
        roleIndent = indent;
        parsedByRole[currentRole] ??= {};
        continue;
      }
      if (trimmed === 'worker:' || trimmed.startsWith('worker:')) {
        currentRole = 'worker';
        roleIndent = indent;
        parsedByRole[currentRole] ??= {};
        continue;
      }

      if (!currentRole || indent <= roleIndent) {
        continue;
      }

      const separatorIndex = trimmed.indexOf(':');
      if (separatorIndex === -1) {
        continue;
      }
      const key = trimmed.slice(0, separatorIndex).trim();
      const value = this.normalizeYamlScalar(trimmed.slice(separatorIndex + 1));
      if (!value) {
        continue;
      }

      if (key === 'provider') {
        const provider = this.normalizeProviderType(value);
        if (provider) {
          parsedByRole[currentRole] = {
            ...parsedByRole[currentRole],
            provider,
          };
        }
      }
      if (key === 'model') {
        parsedByRole[currentRole] = {
          ...parsedByRole[currentRole],
          model: value,
        };
      }
    }

    return (['orchestrator', 'worker'] as const)
      .map((role) => {
        const parsed = parsedByRole[role];
        if (!parsed?.provider || !parsed.model) {
          return null;
        }
        return {
          role,
          provider: parsed.provider,
          model: parsed.model,
        } satisfies ParsedProviderModelSelection;
      })
      .filter((value): value is ParsedProviderModelSelection => Boolean(value));
  }

  private shouldBootstrapProvidersFromConfig(): boolean {
    const agentRow = this.db.raw
      .prepare('SELECT COUNT(1) AS total FROM agents')
      .get() as { total: number } | undefined;
    return (agentRow?.total ?? 0) === 0;
  }

  private bootstrapProvidersFromProjectConfig(): void {
    if (!this.shouldBootstrapProvidersFromConfig()) {
      return;
    }

    const configContent = this.readProjectConfigContent();
    if (!configContent) {
      return;
    }

    const selections = this.parseLlmProviderSelections(configContent);
    if (selections.length === 0) {
      return;
    }

    const modelByProvider = new Map<string, string>();
    for (const selection of selections) {
      // Preserve declaration order so worker can intentionally override orchestrator on shared provider ids.
      modelByProvider.set(selection.provider, selection.model);
    }

    for (const [providerId, model] of modelByProvider) {
      const provider = this.getProvider(providerId);
      if (!provider) {
        continue;
      }
      if (provider.model.trim() === model.trim()) {
        continue;
      }
      this.saveProvider({
        ...provider,
        model: model.trim(),
        apiKey: provider.apiKey,
      });
    }
  }

  private seedProviders(): void {
    const now = new Date().toISOString();
    const insert = this.db.raw.prepare(`
      INSERT OR IGNORE INTO providers (id, name, type, model, baseUrl, apiKey, apiKeyCiphertext, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const preset of DEFAULT_PROVIDERS) {
      insert.run(preset.id, preset.name, preset.type, preset.model, null, null, null, now, now);
    }
  }

  private migrateLegacyProviderApiKeys(): void {
    const rows = this.db.raw
      .prepare('SELECT id, apiKey, apiKeyCiphertext FROM providers')
      .all() as Array<{ id: string; apiKey: string | null; apiKeyCiphertext: string | null }>;
    if (rows.length === 0) {
      return;
    }

    const now = new Date().toISOString();
    const update = this.db.raw.prepare(`
      UPDATE providers
      SET apiKey = ?, apiKeyCiphertext = ?, updatedAt = ?
      WHERE id = ?
    `);

    const tx = this.db.raw.transaction(() => {
      for (const row of rows) {
        const plaintext = row.apiKey?.trim() ?? '';
        if (!plaintext) {
          continue;
        }
        const ciphertext = row.apiKeyCiphertext?.trim()
          ? row.apiKeyCiphertext
          : this.credentials.encrypt(plaintext);
        update.run(null, ciphertext, now, row.id);
      }
    });
    tx();
  }

  private mapProviderRow(row: any): ProviderDefinition {
    const type = row.type as ProviderType;
    const apiKeyFromCiphertext = this.credentials.decrypt(row.apiKeyCiphertext);
    const apiKeyFromLegacy = row.apiKey?.trim() ? row.apiKey.trim() : undefined;
    const apiKey = apiKeyFromCiphertext ?? apiKeyFromLegacy;
    return {
      id: row.id,
      name: row.name,
      type,
      model: row.model?.trim() ? row.model : defaultModelForType(type),
      baseUrl: row.baseUrl ?? undefined,
      apiKey,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  getProviders(): ProviderDefinition[] {
    const rows = this.db.raw.prepare('SELECT * FROM providers ORDER BY createdAt ASC').all() as any[];
    return rows.map((row) => this.mapProviderRow(row));
  }

  getProvider(id: string): ProviderDefinition | null {
    const row = this.db.raw.prepare('SELECT * FROM providers WHERE id = ?').get(id) as any;
    return row ? this.mapProviderRow(row) : null;
  }

  saveProvider(provider: ProviderDefinition): ProviderDefinition {
    const id = provider.id?.trim();
    if (!id) {
      throw new Error('Provider id is required');
    }
    const type = provider.type;
    const name = provider.name?.trim() || id;
    const model = provider.model?.trim() || defaultModelForType(type);
    const now = new Date().toISOString();
    const existing = this.db.raw.prepare('SELECT createdAt, apiKeyCiphertext FROM providers WHERE id = ?').get(id) as
      | { createdAt: string; apiKeyCiphertext: string | null }
      | undefined;
    const createdAt = existing?.createdAt ?? (provider.createdAt?.trim() ? provider.createdAt : now);
    const updatedAt = now;
    const baseUrl = provider.baseUrl?.trim() ? provider.baseUrl.trim() : null;
    const nextApiKey = provider.apiKey?.trim() ? provider.apiKey.trim() : '';
    const apiKeyCiphertext = nextApiKey
      ? this.credentials.encrypt(nextApiKey)
      : existing?.apiKeyCiphertext ?? null;

    this.db.raw.prepare(`
      INSERT OR REPLACE INTO providers (id, name, type, model, baseUrl, apiKey, apiKeyCiphertext, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, name, type, model, baseUrl, null, apiKeyCiphertext, createdAt, updatedAt);

    // Keep agent model in sync with provider-level model binding.
    this.db.raw
      .prepare('UPDATE agents SET model = ?, updatedAt = ? WHERE provider = ?')
      .run(model, updatedAt, id);

    return this.getProvider(id)!;
  }

  deleteProvider(id: string): void {
    const normalized = id.trim();
    if (!normalized) {
      return;
    }
    const inUseRow = this.db.raw.prepare('SELECT COUNT(1) AS total FROM agents WHERE provider = ?').get(
      normalized,
    ) as { total: number };
    if ((inUseRow?.total ?? 0) > 0) {
      throw new Error(`Provider is in use: ${normalized}`);
    }
    this.db.raw.prepare('DELETE FROM providers WHERE id = ?').run(normalized);
  }

  private normalizeWorkflowKind(value: unknown): WorkflowKind | null {
    if (value === 'scene' || value === 'chapter') {
      return value;
    }
    return null;
  }

  private inferWorkflowKindByNames(
    name: string,
    description: string,
    stepAgentIds: string[],
  ): WorkflowKind {
    if (SCENE_NAME_HINT.test(name) || SCENE_NAME_HINT.test(description)) {
      return 'scene';
    }
    if (CHAPTER_NAME_HINT.test(name) || CHAPTER_NAME_HINT.test(description)) {
      return 'chapter';
    }
    if (stepAgentIds.some((agentId) => SCENE_AGENT_HINT.test(agentId))) {
      return 'scene';
    }
    if (stepAgentIds.some((agentId) => CHAPTER_AGENT_HINT.test(agentId))) {
      return 'chapter';
    }

    if (stepAgentIds.length > 0) {
      const uniqueAgentIds = Array.from(new Set(stepAgentIds));
      const placeholders = uniqueAgentIds.map(() => '?').join(', ');
      const rows = this.db.raw
        .prepare(`SELECT id, name FROM agents WHERE id IN (${placeholders})`)
        .all(...uniqueAgentIds) as Array<{ id: string; name: string }>;
      const nameById = new Map(rows.map((row) => [row.id, row.name]));
      const agentNames = uniqueAgentIds
        .map((agentId) => nameById.get(agentId) ?? '')
        .filter((nameValue) => nameValue.length > 0);
      if (agentNames.some((agentName) => SCENE_AGENT_HINT.test(agentName))) {
        return 'scene';
      }
      if (agentNames.some((agentName) => CHAPTER_AGENT_HINT.test(agentName))) {
        return 'chapter';
      }
    }

    return 'chapter';
  }

  private inferWorkflowKind(workflow: Pick<WorkflowDefinition, 'name' | 'description' | 'steps' | 'kind'>): WorkflowKind {
    const explicit = this.normalizeWorkflowKind(workflow.kind);
    if (explicit) {
      return explicit;
    }
    return this.inferWorkflowKindByNames(
      workflow.name ?? '',
      workflow.description ?? '',
      workflow.steps.map((step) => step.agentId),
    );
  }

  private resolveWorkflowKind(
    row: { id: string; name: string; description: string; kind?: string | null },
    stepRows: Array<{ agentId: string }>,
  ): WorkflowKind {
    const explicit = this.normalizeWorkflowKind(row.kind);
    if (explicit) {
      return explicit;
    }
    const inferred = this.inferWorkflowKindByNames(
      row.name ?? '',
      row.description ?? '',
      stepRows.map((step) => step.agentId),
    );
    this.db.raw
      .prepare('UPDATE workflows SET kind = ? WHERE id = ?')
      .run(inferred, row.id);
    return inferred;
  }

  private backfillWorkflowKinds(): void {
    const legacyWorkflows = this.db.raw
      .prepare(
        `SELECT id, name, description, kind
         FROM workflows
         WHERE kind IS NULL OR kind NOT IN ('scene', 'chapter')`,
      )
      .all() as Array<{ id: string; name: string; description: string; kind?: string | null }>;
    if (legacyWorkflows.length === 0) {
      return;
    }

    const selectSteps = this.db.raw.prepare(
      'SELECT agentId FROM workflow_steps WHERE workflowId = ? ORDER BY "order"',
    );
    const updateKind = this.db.raw.prepare('UPDATE workflows SET kind = ? WHERE id = ?');
    const tx = this.db.raw.transaction(() => {
      for (const workflow of legacyWorkflows) {
        const stepRows = selectSteps.all(workflow.id) as Array<{ agentId: string }>;
        const inferred = this.inferWorkflowKindByNames(
          workflow.name ?? '',
          workflow.description ?? '',
          stepRows.map((step) => step.agentId),
        );
        updateKind.run(inferred, workflow.id);
      }
    });
    tx();
  }

  private migrateLegacyOutlinePath(): void {
    if (existsSync(this.canonicalOutlinePath) || !existsSync(this.legacyOutlinePath)) {
      return;
    }
    const legacyContent = readFileSync(this.legacyOutlinePath, 'utf-8');
    mkdirSync(dirname(this.canonicalOutlinePath), { recursive: true });
    writeFileSync(this.canonicalOutlinePath, legacyContent, 'utf-8');
    try {
      unlinkSync(this.legacyOutlinePath);
    } catch {
      // best-effort cleanup: keep canonical file as source of truth even if legacy deletion fails
    }
  }

  // === Workflows ===

  saveWorkflow(wf: WorkflowDefinition): WorkflowDefinition {
    const id = wf.id || nanoid();
    const now = new Date().toISOString();
    const createdAt = wf.createdAt || now;
    const updatedAt = now;
    const kind = this.inferWorkflowKind(wf);

    this.db.raw.prepare(`
      INSERT OR REPLACE INTO workflows (id, projectId, name, description, kind, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, wf.projectId, wf.name, wf.description, kind, createdAt, updatedAt);

    // Delete old steps and re-insert
    this.db.raw.prepare('DELETE FROM workflow_steps WHERE workflowId = ?').run(id);
    const insertStep = this.db.raw.prepare(`
      INSERT INTO workflow_steps (id, workflowId, "order", agentId, enabled, config)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const steps: WorkflowStep[] = wf.steps.map((s, i) => {
      const stepId = s.id || nanoid();
      insertStep.run(stepId, id, s.order ?? i, s.agentId, s.enabled ? 1 : 0, JSON.stringify(s.config ?? {}));
      return { ...s, id: stepId, order: s.order ?? i };
    });

    return { ...wf, id, kind, steps, createdAt, updatedAt };
  }

  getWorkflows(projectId: string): WorkflowDefinition[] {
    const rows = this.db.raw.prepare('SELECT * FROM workflows WHERE projectId = ?').all(projectId) as any[];
    return rows.map(row => {
      const stepRows = this.db.raw.prepare(
        'SELECT * FROM workflow_steps WHERE workflowId = ? ORDER BY "order"'
      ).all(row.id) as any[];
      const kind = this.resolveWorkflowKind(row, stepRows);
      return {
        ...row,
        kind,
        steps: stepRows.map(s => ({
          id: s.id,
          order: s.order,
          agentId: s.agentId,
          enabled: !!s.enabled,
          config: JSON.parse(s.config),
        })),
      };
    });
  }

  getWorkflow(id: string): WorkflowDefinition {
    const row = this.db.raw.prepare('SELECT * FROM workflows WHERE id = ?').get(id) as any;
    if (!row) throw new Error(`Workflow not found: ${id}`);
    const stepRows = this.db.raw.prepare(
      'SELECT * FROM workflow_steps WHERE workflowId = ? ORDER BY "order"'
    ).all(id) as any[];
    const kind = this.resolveWorkflowKind(row, stepRows);
    return {
      ...row,
      kind,
      steps: stepRows.map(s => ({
        id: s.id,
        order: s.order,
        agentId: s.agentId,
        enabled: !!s.enabled,
        config: JSON.parse(s.config),
      })),
    };
  }

  deleteWorkflow(id: string): void {
    this.db.raw.prepare('DELETE FROM workflows WHERE id = ?').run(id);
  }

  // === Agents ===

  saveAgent(agent: AgentDefinition): AgentDefinition {
    const id = agent.id || nanoid();
    const now = new Date().toISOString();
    const createdAt = agent.createdAt || now;
    const updatedAt = now;
    const providerModel = this.getProvider(agent.provider)?.model;
    const normalizedModel = providerModel ?? agent.model?.trim() ?? 'gpt-4o';

    this.db.raw.prepare(`
      INSERT OR REPLACE INTO agents (id, name, category, provider, model, temperature, maxTokens, agentMdPath, promptTemplate, inputSchema, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      agent.name,
      agent.category,
      agent.provider,
      normalizedModel,
      agent.temperature,
      agent.maxTokens ?? null,
      agent.agentMdPath,
      agent.promptTemplate,
      JSON.stringify(agent.inputSchema),
      createdAt,
      updatedAt,
    );

    return { ...agent, model: normalizedModel, id, createdAt, updatedAt };
  }

  getAgents(): AgentDefinition[] {
    const rows = this.db.raw.prepare('SELECT * FROM agents').all() as any[];
    return rows.map(row => ({
      ...row,
      maxTokens: row.maxTokens ?? undefined,
      inputSchema: JSON.parse(row.inputSchema),
    }));
  }

  deleteAgent(id: string): void {
    this.db.raw.prepare('DELETE FROM agents WHERE id = ?').run(id);
  }

  getAgentMd(agentMdPath: string): string {
    return readFileSync(join(this.basePath, agentMdPath), 'utf-8');
  }

  saveAgentMd(agentMdPath: string, content: string): void {
    const fullPath = join(this.basePath, agentMdPath);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, content, 'utf-8');
  }

  // === Scenes ===

  saveScene(scene: Omit<SceneCard, 'id' | 'createdAt' | 'updatedAt'> & { id?: string; createdAt?: string; updatedAt?: string }): SceneCard {
    const id = scene.id || nanoid();
    const now = new Date().toISOString();
    const createdAt = scene.createdAt || now;
    const updatedAt = now;

    this.db.raw.prepare(`
      INSERT OR REPLACE INTO scenes (id, projectId, chapterId, parentId, "order", title, characters, location, eventSkeleton, tags, sourceOutline, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, scene.projectId, scene.chapterId ?? null, scene.parentId ?? null,
      scene.order, scene.title, JSON.stringify(scene.characters),
      scene.location, JSON.stringify(scene.eventSkeleton),
      JSON.stringify(scene.tags), scene.sourceOutline, createdAt, updatedAt);

    return {
      id, projectId: scene.projectId, chapterId: scene.chapterId,
      parentId: scene.parentId, order: scene.order, title: scene.title,
      characters: scene.characters, location: scene.location,
      eventSkeleton: scene.eventSkeleton, tags: scene.tags,
      sourceOutline: scene.sourceOutline, createdAt, updatedAt,
    };
  }

  getScenes(projectId: string): SceneCard[] {
    const rows = this.db.raw.prepare(
      'SELECT * FROM scenes WHERE projectId = ? ORDER BY "order"'
    ).all(projectId) as any[];
    return rows.map(row => ({
      ...row,
      chapterId: row.chapterId ?? undefined,
      parentId: row.parentId ?? undefined,
      characters: JSON.parse(row.characters),
      eventSkeleton: JSON.parse(row.eventSkeleton),
      tags: JSON.parse(row.tags),
    }));
  }

  deleteScene(id: string): void {
    this.db.raw.prepare('DELETE FROM scenes WHERE id = ?').run(id);
  }

  reorderScenes(ids: string[]): void {
    const update = this.db.raw.prepare('UPDATE scenes SET "order" = ? WHERE id = ?');
    const tx = this.db.raw.transaction(() => {
      ids.forEach((id, i) => update.run(i, id));
    });
    tx();
  }

  // === Chapters ===

  saveChapter(chapter: Omit<Chapter, 'id' | 'createdAt' | 'updatedAt'> & { id?: string; createdAt?: string; updatedAt?: string }): Chapter {
    const id = chapter.id || nanoid();
    const now = new Date().toISOString();
    const createdAt = chapter.createdAt || now;
    const updatedAt = now;

    this.db.raw.prepare(`
      INSERT OR REPLACE INTO chapters (id, projectId, number, title, status, workflowId, contentPath, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, chapter.projectId, chapter.number, chapter.title,
      chapter.status, chapter.workflowId ?? null, chapter.contentPath, createdAt, updatedAt);

    return {
      id, projectId: chapter.projectId, number: chapter.number,
      title: chapter.title, status: chapter.status,
      workflowId: chapter.workflowId, contentPath: chapter.contentPath,
      createdAt, updatedAt,
    };
  }

  getChapters(projectId: string): Chapter[] {
    const rows = this.db.raw.prepare(
      'SELECT * FROM chapters WHERE projectId = ? ORDER BY number'
    ).all(projectId) as any[];
    return rows.map(row => ({
      ...row,
      workflowId: row.workflowId ?? undefined,
    }));
  }

  getChapter(id: string): Chapter {
    const row = this.db.raw.prepare('SELECT * FROM chapters WHERE id = ?').get(id) as any;
    if (!row) throw new Error(`Chapter not found: ${id}`);
    return { ...row, workflowId: row.workflowId ?? undefined };
  }

  saveChapterContent(chapterId: string, content: string): void {
    const chapter = this.db.raw.prepare('SELECT * FROM chapters WHERE id = ?').get(chapterId) as any;
    if (!chapter) throw new Error(`Chapter not found: ${chapterId}`);
    const project = this.db.raw.prepare('SELECT * FROM projects WHERE id = ?').get(chapter.projectId) as any;
    const fullPath = join(project.basePath, chapter.contentPath);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, content, 'utf-8');
  }

  getChapterContent(chapterId: string): string {
    const chapter = this.db.raw.prepare('SELECT * FROM chapters WHERE id = ?').get(chapterId) as any;
    if (!chapter) throw new Error(`Chapter not found: ${chapterId}`);
    const project = this.db.raw.prepare('SELECT * FROM projects WHERE id = ?').get(chapter.projectId) as any;
    return readFileSync(join(project.basePath, chapter.contentPath), 'utf-8');
  }

  getOutlineContent(): string {
    this.migrateLegacyOutlinePath();
    try {
      return readFileSync(this.canonicalOutlinePath, 'utf-8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return '';
      }
      throw error;
    }
  }

  saveOutlineContent(content: string): void {
    mkdirSync(dirname(this.canonicalOutlinePath), { recursive: true });
    writeFileSync(this.canonicalOutlinePath, content, 'utf-8');
  }

  // === Executions ===

  saveExecution(exec: Omit<Execution, 'id'> & { id?: string }): Execution {
    const id = exec.id || nanoid();
    const existing = this.db.raw.prepare('SELECT id FROM executions WHERE id = ?').get(id);
    if (existing) {
      this.db.raw.prepare(`
        UPDATE executions SET projectId = ?, chapterId = ?, workflowId = ?, status = ?, startedAt = ?, completedAt = ?
        WHERE id = ?
      `).run(exec.projectId, exec.chapterId ?? null, exec.workflowId,
        exec.status, exec.startedAt, exec.completedAt ?? null, id);
    } else {
      this.db.raw.prepare(`
        INSERT INTO executions (id, projectId, chapterId, workflowId, status, startedAt, completedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(id, exec.projectId, exec.chapterId ?? null, exec.workflowId,
        exec.status, exec.startedAt, exec.completedAt ?? null);
    }
    return { ...exec, id };
  }

  saveExecutionStep(step: Omit<ExecutionStep, 'id'> & { id?: string }): ExecutionStep {
    const id = step.id || nanoid();
    this.db.raw.prepare(`
      INSERT OR REPLACE INTO execution_steps (id, executionId, stepId, agentId, status, input, output, tokens, duration, "order")
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, step.executionId, step.stepId, step.agentId, step.status,
      step.input ?? null, step.output ?? null, step.tokens ?? null,
      step.duration ?? null, step.order);
    return { ...step, id };
  }

  getExecutions(projectId: string): Execution[] {
    return this.db.raw.prepare(
      'SELECT * FROM executions WHERE projectId = ? ORDER BY startedAt DESC'
    ).all(projectId) as Execution[];
  }

  getExecutionDetail(executionId: string): { execution: Execution; steps: ExecutionStep[] } {
    const execution = this.db.raw.prepare('SELECT * FROM executions WHERE id = ?').get(executionId) as Execution;
    if (!execution) throw new Error(`Execution not found: ${executionId}`);
    const steps = this.db.raw.prepare(
      'SELECT * FROM execution_steps WHERE executionId = ? ORDER BY "order"'
    ).all(executionId) as ExecutionStep[];
    return { execution, steps };
  }

  // === Entities ===

  saveEntity(entity: Omit<Entity, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): Entity {
    const id = entity.id || nanoid();
    const now = new Date().toISOString();
    this.db.raw.prepare(`
      INSERT OR REPLACE INTO entities (id, projectId, type, name, data, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, entity.projectId, entity.type, entity.name, JSON.stringify(entity.data), now, now);
    return { ...entity, id, createdAt: now, updatedAt: now };
  }

  queryEntities(projectId: string, type?: string): Entity[] {
    if (type) {
      return (this.db.raw.prepare(
        'SELECT * FROM entities WHERE projectId = ? AND type = ?'
      ).all(projectId, type) as any[]).map(r => ({ ...r, data: JSON.parse(r.data) }));
    }
    return (this.db.raw.prepare(
      'SELECT * FROM entities WHERE projectId = ?'
    ).all(projectId) as any[]).map(r => ({ ...r, data: JSON.parse(r.data) }));
  }

  close(): void {
    this.db.close();
  }
}
