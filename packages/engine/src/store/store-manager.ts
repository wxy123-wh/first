import { nanoid } from 'nanoid';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { Database } from './database.js';
import type {
  Project, TagTemplateEntry, WorkflowDefinition, WorkflowStep,
  AgentDefinition, SceneCard, Chapter, ChapterStatus,
  Execution, ExecutionStatus, ExecutionStep, StepStatus, Entity,
} from '../types.js';

export class StoreManager {
  private db: Database;
  private basePath: string;

  constructor(projectPath: string) {
    this.basePath = projectPath;
    this.db = new Database(projectPath);
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

  // === Workflows ===

  saveWorkflow(wf: WorkflowDefinition): WorkflowDefinition {
    const id = wf.id || nanoid();
    const now = new Date().toISOString();
    const createdAt = wf.createdAt || now;
    const updatedAt = now;

    this.db.raw.prepare(`
      INSERT OR REPLACE INTO workflows (id, projectId, name, description, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, wf.projectId, wf.name, wf.description, createdAt, updatedAt);

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

    return { ...wf, id, steps, createdAt, updatedAt };
  }

  getWorkflows(projectId: string): WorkflowDefinition[] {
    const rows = this.db.raw.prepare('SELECT * FROM workflows WHERE projectId = ?').all(projectId) as any[];
    return rows.map(row => {
      const stepRows = this.db.raw.prepare(
        'SELECT * FROM workflow_steps WHERE workflowId = ? ORDER BY "order"'
      ).all(row.id) as any[];
      return {
        ...row,
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
    return {
      ...row,
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

    this.db.raw.prepare(`
      INSERT OR REPLACE INTO agents (id, name, category, provider, model, temperature, maxTokens, agentMdPath, promptTemplate, inputSchema, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, agent.name, agent.category, agent.provider, agent.model, agent.temperature,
      agent.maxTokens ?? null, agent.agentMdPath, agent.promptTemplate,
      JSON.stringify(agent.inputSchema), createdAt, updatedAt);

    return { ...agent, id, createdAt, updatedAt };
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
