import { nanoid } from 'nanoid';
import type { WorkflowEventHandler } from './events.js';
import type { StoreManager } from '../store/store-manager.js';
import type { AgentRegistry } from '../agent/registry.js';
import type { AgentExecutor } from '../agent/executor.js';
import type { ContextBuilder } from './context-builder.js';
import type { WorkflowDefinition, SceneCard } from '../types.js';
import { renderTemplate } from '../template/engine.js';

interface ParsedSceneDraft {
  title: string;
  characters: string[];
  location: string;
  eventSkeleton: string[];
  tags: Record<string, string>;
  chapterId?: string;
  parentId?: string;
}

interface ExecutionControlState {
  paused: boolean;
  aborted: boolean;
  pauseResolver: (() => void) | null;
  skippedSteps: Set<string>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === 'string' ? item.trim() : String(item ?? '').trim()))
      .filter((item) => item.length > 0);
  }
  if (typeof value === 'string') {
    return value
      .split(/[\r\n,，、]/)
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }
  return [];
}

function toTags(value: unknown): Record<string, string> {
  const record = asRecord(value);
  if (!record) {
    return {};
  }
  const normalized: Record<string, string> = {};
  for (const [key, raw] of Object.entries(record)) {
    if (raw === null || raw === undefined) continue;
    const str = typeof raw === 'string' ? raw.trim() : String(raw).trim();
    if (!str) continue;
    normalized[key] = str;
  }
  return normalized;
}

function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1].trim() : trimmed;
}

function tryParseJson(text: string): unknown | null {
  const normalized = stripCodeFence(text);
  if (!normalized) {
    return null;
  }
  try {
    return JSON.parse(normalized);
  } catch {
    return null;
  }
}

function extractSceneList(parsed: unknown): unknown[] {
  const record = asRecord(parsed);
  if (!record) {
    return [];
  }
  if (Array.isArray(record.scenes)) {
    return record.scenes;
  }
  return [];
}

function collectUnresolvedPlaceholders(renderedTemplate: string): string[] {
  const matches = renderedTemplate.match(/\{\{\s*[^{}]+\s*\}\}/g) ?? [];
  return [...new Set(matches.map((match) => match.trim()))];
}

function eventSkeletonFingerprint(eventSkeleton: string[]): string {
  return eventSkeleton
    .map((item) => item.trim().toLocaleLowerCase())
    .filter((item) => item.length > 0)
    .join('|');
}

function sceneDedupeKey(title: string, chapterId: string | undefined, eventSkeleton: string[]): string {
  const normalizedTitle = title.trim().toLocaleLowerCase();
  const normalizedChapterId = (chapterId ?? '').trim();
  return `${normalizedTitle}::${normalizedChapterId}::${eventSkeletonFingerprint(eventSkeleton)}`;
}

function normalizeSceneDraft(value: unknown, fallbackTitle: string): ParsedSceneDraft | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const titleRaw = record.title ?? record.sceneTitle ?? record.name;
  const title = typeof titleRaw === 'string' ? titleRaw.trim() : '';
  const characters = toStringArray(record.characters ?? record.roles);
  const locationRaw = record.location ?? record.place;
  const location = typeof locationRaw === 'string' ? locationRaw.trim() : '';
  const eventSkeleton = toStringArray(
    record.eventSkeleton ?? record.events ?? record.beats ?? record.eventOutline,
  );
  const tags = toTags(record.tags ?? record.labels);
  const chapterIdRaw = record.chapterId;
  const chapterId =
    typeof chapterIdRaw === 'string' && chapterIdRaw.trim().length > 0
      ? chapterIdRaw.trim()
      : undefined;
  const parentIdRaw = record.parentId;
  const parentId =
    typeof parentIdRaw === 'string' && parentIdRaw.trim().length > 0
      ? parentIdRaw.trim()
      : undefined;

  if (!title && eventSkeleton.length === 0) {
    return null;
  }

  return {
    title: title || fallbackTitle,
    characters,
    location,
    eventSkeleton,
    tags,
    chapterId,
    parentId,
  };
}

export class WorkflowRuntime {
  private executionControls = new Map<string, ExecutionControlState>();
  private handlers: WorkflowEventHandler[] = [];

  constructor(
    private store: StoreManager,
    private agentRegistry: AgentRegistry,
    private agentExecutor: AgentExecutor,
    private contextBuilder?: ContextBuilder,
  ) {}

  on(handler: WorkflowEventHandler): void {
    this.handlers.push(handler);
  }

  private emit(event: Parameters<WorkflowEventHandler>[0]): void {
    for (const handler of this.handlers) handler(event);
  }

  private createExecutionControl(executionId: string): ExecutionControlState {
    const control: ExecutionControlState = {
      paused: false,
      aborted: false,
      pauseResolver: null,
      skippedSteps: new Set<string>(),
    };
    this.executionControls.set(executionId, control);
    return control;
  }

  private getExecutionControl(executionId: string): ExecutionControlState {
    const control = this.executionControls.get(executionId);
    if (!control) {
      throw new Error(`Execution not running: ${executionId}`);
    }
    return control;
  }

  private clearExecutionControl(executionId: string): void {
    this.executionControls.delete(executionId);
  }

  private resolveModelForProvider(providerId: string, fallbackModel: string): string {
    const configured = this.store.getProvider(providerId)?.model?.trim();
    return configured || fallbackModel;
  }

  private envHasApiKey(providerId: string): boolean {
    const env = process.env;
    switch (providerId) {
      case 'openai':
        return Boolean(env.OPENAI_API_KEY?.trim());
      case 'anthropic':
        return Boolean(env.ANTHROPIC_API_KEY?.trim());
      case 'newapi':
        return Boolean(env.NEWAPI_API_KEY?.trim() || env.NEW_API_KEY?.trim());
      default:
        return false;
    }
  }

  private providerHasCredential(providerId: string): boolean {
    const provider = this.store.getProvider(providerId);
    if (provider?.apiKey?.trim()) {
      return true;
    }
    return this.envHasApiKey(providerId);
  }

  private resolveProviderForStep(preferredProvider: string): string {
    if (this.providerHasCredential(preferredProvider)) {
      return preferredProvider;
    }
    const fallback = this.store
      .getProviders()
      .find((provider) => this.providerHasCredential(provider.id));
    return fallback?.id ?? preferredProvider;
  }

  private buildSceneInstructions(
    sourceOutline: string,
    existingScenes: SceneCard[],
    tagTemplate: unknown,
  ): string {
    const lines = [
      '请将以下大纲拆解为结构化场景卡片。',
      '要求仅输出 JSON，不要输出解释文字。',
      'JSON 格式:',
      '{"scenes":[{"title":"","characters":[],"location":"","eventSkeleton":[],"tags":{},"chapterId":"","parentId":""}]}',
      `已有场景数量: ${existingScenes.length}（避免重复）`,
      `标签模板: ${JSON.stringify(tagTemplate ?? [])}`,
      '',
      '大纲原文:',
      sourceOutline,
    ];
    return lines.join('\n');
  }

  private buildChapterInstructions(chapterContext: Record<string, unknown>): string {
    const chapter = asRecord(chapterContext.chapter);
    const chapterTitle = typeof chapter?.title === 'string' ? chapter.title : '未命名章节';
    const chapterNumber =
      typeof chapter?.number === 'number' || typeof chapter?.number === 'string'
        ? String(chapter.number)
        : '';
    const scenes = Array.isArray(chapterContext.scenes) ? chapterContext.scenes : [];
    const previousTail =
      typeof chapterContext.previousChapterTail === 'string' ? chapterContext.previousChapterTail : '';
    return [
      `请围绕第${chapterNumber || '?'}章《${chapterTitle}》完成当前步骤任务。`,
      `本章场景数量: ${scenes.length}`,
      previousTail ? `上章末尾: ${previousTail}` : '上章末尾: （无）',
    ].join('\n');
  }

  private enrichGlobalContext(
    workflow: WorkflowDefinition,
    globalContext: Record<string, unknown>,
    chapterId?: string,
  ): Record<string, unknown> {
    const contextFromInput = asRecord(globalContext.context);
    const context: Record<string, unknown> = contextFromInput ? { ...contextFromInput } : {};

    if (chapterId && this.contextBuilder) {
      const chapterContext = this.contextBuilder.buildChapterContext(chapterId);
      context.chapter = chapterContext.chapter;
      context.scenes = chapterContext.scenes;
      context.previousChapterTail = chapterContext.previousChapterTail;
      context.previousTail = chapterContext.previousChapterTail;
      context.entities = chapterContext.entities;
    }

    const sourceOutlineRaw = globalContext.sourceOutline ?? context.sourceOutline;
    const sourceOutline =
      typeof sourceOutlineRaw === 'string' && sourceOutlineRaw.trim().length > 0
        ? sourceOutlineRaw.trim()
        : '';
    if (sourceOutline && this.contextBuilder) {
      const decomposeContext = this.contextBuilder.buildDecomposeContext(sourceOutline, workflow.projectId);
      context.sourceOutline = decomposeContext.sourceOutline;
      context.existingScenes = decomposeContext.existingScenes;
      context.tagTemplate = decomposeContext.tagTemplate;
    } else if (sourceOutline) {
      context.sourceOutline = sourceOutline;
    }

    const merged: Record<string, unknown> = {
      ...globalContext,
      context,
      chapterId: chapterId ?? globalContext.chapterId,
      chapter: context.chapter ?? globalContext.chapter,
      scenes: context.scenes ?? globalContext.scenes,
      entities: context.entities ?? globalContext.entities,
      previousTail: context.previousTail ?? context.previousChapterTail ?? globalContext.previousTail,
      previousChapterTail: context.previousChapterTail ?? globalContext.previousChapterTail,
      sourceOutline: sourceOutline || globalContext.sourceOutline,
    };

    const instructionsRaw = merged.instructions;
    const hasInstructions =
      typeof instructionsRaw === 'string' && instructionsRaw.trim().length > 0;
    if (!hasInstructions) {
      if (sourceOutline) {
        const existingScenes = Array.isArray(context.existingScenes)
          ? (context.existingScenes as SceneCard[])
          : [];
        merged.instructions = this.buildSceneInstructions(sourceOutline, existingScenes, context.tagTemplate);
      } else if (chapterId) {
        merged.instructions = this.buildChapterInstructions(context);
      } else {
        // Keep builtin {{instructions}} templates resolvable when no explicit instructions are provided.
        merged.instructions = '';
      }
    }

    return merged;
  }

  private persistScenesFromOutputs(
    workflow: WorkflowDefinition,
    chapterId: string | undefined,
    sourceOutline: string,
    stepOutputs: Record<string, string>,
  ): number {
    const outputCandidates = Object.values(stepOutputs);
    const existing = this.store.getScenes(workflow.projectId);
    const dedupe = new Set(
      existing.map((scene) => sceneDedupeKey(scene.title, scene.chapterId, scene.eventSkeleton)),
    );
    let nextOrder = existing.reduce((maxOrder, scene) => Math.max(maxOrder, scene.order), -1) + 1;
    let savedCount = 0;

    for (const output of outputCandidates) {
      const parsed = tryParseJson(output);
      const sceneList = extractSceneList(parsed);
      if (sceneList.length === 0) {
        continue;
      }

      for (let i = 0; i < sceneList.length; i++) {
        const scene = normalizeSceneDraft(sceneList[i], `新场景 ${nextOrder + 1}`);
        if (!scene) {
          continue;
        }
        const targetChapterId = scene.chapterId ?? chapterId;
        const dedupeKey = sceneDedupeKey(scene.title, targetChapterId, scene.eventSkeleton);
        if (dedupe.has(dedupeKey)) {
          continue;
        }
        this.store.saveScene({
          projectId: workflow.projectId,
          chapterId: targetChapterId,
          parentId: scene.parentId,
          order: nextOrder,
          title: scene.title,
          characters: scene.characters,
          location: scene.location,
          eventSkeleton: scene.eventSkeleton,
          tags: scene.tags,
          sourceOutline,
        });
        dedupe.add(dedupeKey);
        nextOrder += 1;
        savedCount += 1;
      }
    }

    return savedCount;
  }

  async run(workflowId: string, globalContext: Record<string, unknown>, chapterId?: string): Promise<void> {
    let executionId: string | undefined;

    try {
      const workflow = this.store.getWorkflow(workflowId);
      const resolvedGlobalContext = this.enrichGlobalContext(workflow, globalContext, chapterId);
      const enabledSteps = workflow.steps.filter(s => s.enabled);

      // Create execution record
      const execution = this.store.saveExecution({
        projectId: workflow.projectId,
        chapterId,
        workflowId,
        status: 'running',
        startedAt: new Date().toISOString(),
      });
      executionId = execution.id;
      const control = this.createExecutionControl(execution.id);

      this.emit({ type: 'workflow:start', executionId: execution.id, workflowId, chapterId });

      const stepOutputs: Record<string, string> = {};

      for (let i = 0; i < enabledSteps.length; i++) {
        // Check abort
        if (control.aborted) break;

        // Check pause — wait until resumed
        if (control.paused) {
          await new Promise<void>(resolve => {
            control.pauseResolver = resolve;
          });
        }

        // Check abort again after resume
        if (control.aborted) break;

        const step = enabledSteps[i];

        // Check if step is marked for skip
        if (control.skippedSteps.has(step.id)) {
          this.store.saveExecutionStep({
            executionId: execution.id,
            stepId: step.id,
            agentId: step.agentId,
            status: 'skipped',
            order: i,
          });
          continue;
        }

        this.emit({ type: 'step:start', executionId: execution.id, stepId: step.id, agentId: step.agentId });

        // Load agent definition
        const agents = this.agentRegistry.list();
        const agent = agents.find(a => a.id === step.agentId);
        if (!agent) {
          const error = `Agent not found: ${step.agentId}`;
          this.emit({ type: 'step:failed', executionId: execution.id, stepId: step.id, error });
          this.store.saveExecutionStep({
            executionId: execution.id,
            stepId: step.id,
            agentId: step.agentId,
            status: 'failed',
            order: i,
          });
          break;
        }

        // Build context with previous step outputs + global context
        const context: Record<string, unknown> = {
          ...resolvedGlobalContext,
          prev: i > 0 ? { output: stepOutputs[enabledSteps[i - 1].id] } : undefined,
          step: stepOutputs,
        };

        try {
          const agentMd = this.agentRegistry.getAgentMd(agent.id);
          const provider = this.resolveProviderForStep(step.config?.provider ?? agent.provider);
          const model = step.config?.model ?? this.resolveModelForProvider(provider, agent.model);
          const temperature = step.config?.temperature ?? agent.temperature;
          const maxTokens = step.config?.maxTokens ?? agent.maxTokens;
          const renderedPrompt = renderTemplate(agent.promptTemplate, context);
          const unresolved = collectUnresolvedPlaceholders(renderedPrompt);
          if (unresolved.length > 0) {
            throw new Error(
              `模板渲染失败：存在未解析占位符 ${unresolved.join(', ')}。请检查步骤模板变量与上下文字段是否匹配。`,
            );
          }

          const result = await this.agentExecutor.execute({
            agentMd,
            promptTemplate: renderedPrompt,
            context: {},
            provider,
            model,
            temperature,
            maxTokens,
          });

          stepOutputs[step.id] = result.text;

          this.emit({
            type: 'step:complete',
            executionId: execution.id,
            stepId: step.id,
            output: result.text,
            tokens: result.tokens,
            duration: result.duration,
          });

          this.store.saveExecutionStep({
            executionId: execution.id,
            stepId: step.id,
            agentId: step.agentId,
            status: 'completed',
            input: agent.promptTemplate,
            output: result.text,
            tokens: result.tokens,
            duration: result.duration,
            order: i,
          });
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          this.emit({ type: 'step:failed', executionId: execution.id, stepId: step.id, error });
          this.store.saveExecutionStep({
            executionId: execution.id,
            stepId: step.id,
            agentId: step.agentId,
            status: 'failed',
            input: agent.promptTemplate,
            output: error,
            order: i,
          });
          // Mark execution as failed
          this.store.saveExecution({ ...execution, status: 'failed', completedAt: new Date().toISOString() });
          return;
        }
      }

      const finalStatus = control.aborted ? 'failed' : 'completed';
      let persistedScenes = 0;
      const sourceOutline = resolvedGlobalContext.sourceOutline;
      if (finalStatus === 'completed') {
        persistedScenes = this.persistScenesFromOutputs(
          workflow,
          chapterId,
          typeof sourceOutline === 'string' ? sourceOutline.trim() : '',
          stepOutputs,
        );
      }
      this.store.saveExecution({ ...execution, status: finalStatus, completedAt: new Date().toISOString() });

      this.emit({
        type: 'workflow:complete',
        executionId: execution.id,
        chapterId,
        summary: `Workflow ${finalStatus}. ${Object.keys(stepOutputs).length} steps produced output. 已保存 ${persistedScenes} 条场景。`,
      });
    } finally {
      if (executionId) {
        this.clearExecutionControl(executionId);
      }
    }
  }

  pause(executionId: string): void {
    const control = this.getExecutionControl(executionId);
    control.paused = true;
  }

  resume(executionId: string): void {
    const control = this.getExecutionControl(executionId);
    control.paused = false;
    if (control.pauseResolver) {
      control.pauseResolver();
      control.pauseResolver = null;
    }
  }

  abort(executionId: string): void {
    const control = this.getExecutionControl(executionId);
    control.aborted = true;
    // Also resume if paused, so the loop can exit
    this.resume(executionId);
  }

  skip(executionId: string, stepId: string): void {
    const control = this.getExecutionControl(executionId);
    control.skippedSteps.add(stepId);
  }

  async rerun(executionId: string, fromStepId: string): Promise<void> {
    const detail = this.store.getExecutionDetail(executionId);
    const execution = detail.execution;
    const workflow = this.store.getWorkflow(execution.workflowId);
    const enabledSteps = workflow.steps.filter(s => s.enabled);

    // Find the index of the target step
    const fromIndex = enabledSteps.findIndex(s => s.id === fromStepId);
    if (fromIndex === -1) throw new Error(`Step not found in workflow: ${fromStepId}`);

    // Collect outputs from steps before fromIndex
    const stepOutputs: Record<string, string> = {};
    for (let i = 0; i < fromIndex; i++) {
      const existingStep = detail.steps.find(s => s.stepId === enabledSteps[i].id);
      if (existingStep?.output) stepOutputs[enabledSteps[i].id] = existingStep.output;
    }

    // Mark execution as running again
    this.store.saveExecution({ ...execution, status: 'running', completedAt: undefined });

    // Re-execute from fromIndex
    for (let i = fromIndex; i < enabledSteps.length; i++) {
      const step = enabledSteps[i];
      const agents = this.agentRegistry.list();
      const agent = agents.find(a => a.id === step.agentId);
      if (!agent) throw new Error(`Agent not found: ${step.agentId}`);

      const context: Record<string, unknown> = {
        prev: i > 0 ? { output: stepOutputs[enabledSteps[i - 1].id] } : undefined,
        step: stepOutputs,
      };

      const agentMd = this.agentRegistry.getAgentMd(agent.id);
      const provider = step.config?.provider ?? agent.provider;
      const result = await this.agentExecutor.execute({
        agentMd,
        promptTemplate: agent.promptTemplate,
        context,
        provider,
        model: step.config?.model ?? this.resolveModelForProvider(provider, agent.model),
        temperature: step.config?.temperature ?? agent.temperature,
        maxTokens: step.config?.maxTokens ?? agent.maxTokens,
      });

      stepOutputs[step.id] = result.text;

      // Update or insert execution step
      const existingStep = detail.steps.find(s => s.stepId === step.id);
      this.store.saveExecutionStep({
        id: existingStep?.id,
        executionId,
        stepId: step.id,
        agentId: step.agentId,
        status: 'completed',
        input: agent.promptTemplate,
        output: result.text,
        tokens: result.tokens,
        duration: result.duration,
        order: i,
      });
    }

    this.store.saveExecution({ ...execution, status: 'completed', completedAt: new Date().toISOString() });
  }
}
