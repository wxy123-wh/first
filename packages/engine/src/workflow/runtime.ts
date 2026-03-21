import { nanoid } from 'nanoid';
import type { WorkflowEventHandler } from './events.js';
import type { StoreManager } from '../store/store-manager.js';
import type { AgentRegistry } from '../agent/registry.js';
import type { AgentExecutor } from '../agent/executor.js';
import type { ContextBuilder } from './context-builder.js';
import type { WorkflowDefinition, SceneCard, DecomposeContext, AgentDefinition } from '../types.js';
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
  currentStepId: string | null;
  currentStepController: AbortController | null;
  interruption: { type: 'abort' | 'skip'; stepId: string } | null;
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

interface JsonParseResult {
  value: unknown;
  source: 'raw' | 'fenced' | 'repair';
}

interface JsonParseAttempt {
  parsed: unknown | null;
  parseError?: string;
  repaired: boolean;
}

interface SceneNormalizationResult {
  scene: ParsedSceneDraft | null;
  error?: string;
}

interface ScenePersistResult {
  savedCount: number;
  boundCount: number;
  unboundCount: number;
  fallbackBoundCount: number;
  parsedPayloadCount: number;
  parsedSceneCount: number;
  repairCount: number;
  parseErrors: string[];
  validationErrors: string[];
}

interface SceneInstructionBundle {
  decompose: string;
  transition: string;
  validation: string;
}

function parseJsonCandidate(candidate: string): unknown | null {
  const normalized = candidate.trim();
  if (!normalized) {
    return null;
  }
  try {
    return JSON.parse(normalized);
  } catch {
    return null;
  }
}

function collectJsonFencedBlocks(text: string): string[] {
  const blocks: string[] = [];
  const pattern = /```(?:json)?\s*([\s\S]*?)```/gi;
  for (const match of text.matchAll(pattern)) {
    const body = match[1]?.trim();
    if (body) {
      blocks.push(body);
    }
  }
  return blocks;
}

function tryParseJsonFromStandardCandidates(text: string): JsonParseResult | null {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }

  const raw = parseJsonCandidate(trimmed);
  if (raw !== null) {
    return { value: raw, source: 'raw' };
  }

  const blocks = collectJsonFencedBlocks(trimmed);
  for (const block of blocks) {
    const parsed = parseJsonCandidate(block);
    if (parsed !== null) {
      return { value: parsed, source: 'fenced' };
    }
  }

  return null;
}

function firstJsonStartIndex(text: string): number {
  const objectIndex = text.indexOf('{');
  const arrayIndex = text.indexOf('[');
  if (objectIndex === -1) {
    return arrayIndex;
  }
  if (arrayIndex === -1) {
    return objectIndex;
  }
  return Math.min(objectIndex, arrayIndex);
}

function extractBalancedJsonSegment(text: string): string | null {
  const source = text.trim();
  if (!source) {
    return null;
  }

  const start = firstJsonStartIndex(source);
  if (start < 0) {
    return null;
  }

  const open = source[start];
  const close = open === '{' ? '}' : open === '[' ? ']' : '';
  if (!close) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === open) {
      depth += 1;
      continue;
    }
    if (char === close) {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, index + 1).trim();
      }
    }
  }

  return null;
}

function parseJsonWithOneRepairRetry(text: string): JsonParseAttempt {
  const standard = tryParseJsonFromStandardCandidates(text);
  if (standard) {
    return { parsed: standard.value, repaired: false };
  }

  const repairedCandidate = extractBalancedJsonSegment(text);
  if (!repairedCandidate) {
    return {
      parsed: null,
      repaired: false,
      parseError: 'JSON 解析失败：未找到可解析的 JSON 结构。',
    };
  }

  const repairedParsed = parseJsonCandidate(repairedCandidate);
  if (repairedParsed !== null) {
    return { parsed: repairedParsed, repaired: true };
  }

  return {
    parsed: null,
    repaired: false,
    parseError: 'JSON 解析失败：尝试一次自动修复后仍无法解析。',
  };
}

function isStructuredJsonPayload(text: string): boolean {
  const parsed = tryParseJsonFromStandardCandidates(text);
  if (parsed === null) {
    return false;
  }
  return typeof parsed.value === 'object';
}

function extractSceneList(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) {
    return parsed;
  }
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

function normalizeSceneDraft(value: unknown, outputIndex: number, sceneIndex: number): SceneNormalizationResult {
  const record = asRecord(value);
  if (!record) {
    return {
      scene: null,
      error: `输出 #${outputIndex} 的第 ${sceneIndex} 条场景不是对象。`,
    };
  }

  const issues: string[] = [];
  const titleRaw = record.title ?? record.sceneTitle ?? record.name;
  const title = typeof titleRaw === 'string' ? titleRaw.trim() : '';
  if (!title) {
    issues.push('字段 title 必须是非空字符串');
  }

  const eventRaw = record.eventSkeleton ?? record.events ?? record.beats ?? record.eventOutline;
  let eventSkeleton: string[] = [];
  if (!Array.isArray(eventRaw)) {
    issues.push('字段 eventSkeleton 必须是字符串数组');
  } else {
    eventSkeleton = eventRaw
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter((item) => item.length > 0);
    if (eventSkeleton.length === 0) {
      issues.push('字段 eventSkeleton 不能为空');
    }
  }

  const tagsRaw = record.tags ?? record.labels;
  const tagsRecord =
    tagsRaw === undefined || tagsRaw === null
      ? {}
      : asRecord(tagsRaw);
  if (tagsRaw !== undefined && tagsRaw !== null && !tagsRecord) {
    issues.push('字段 tags 必须是对象');
  }

  if (issues.length > 0) {
    return {
      scene: null,
      error: `输出 #${outputIndex} 的第 ${sceneIndex} 条场景${issues.join('；')}。`,
    };
  }

  const characters = toStringArray(record.characters ?? record.roles);
  const locationRaw = record.location ?? record.place;
  const location = typeof locationRaw === 'string' ? locationRaw.trim() : '';
  const tags = toTags(tagsRecord ?? {});
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

  return {
    scene: {
      title,
      characters,
      location,
      eventSkeleton,
      tags,
      chapterId,
      parentId,
    },
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
      currentStepId: null,
      currentStepController: null,
      interruption: null,
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

  private isAbortError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }
    return (
      error.name === 'AbortError' ||
      /abort|aborted|cancelled|canceled|terminated|interrupted/i.test(error.message)
    );
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

  private formatList(items: string[], emptyFallback: string): string {
    if (items.length === 0) {
      return emptyFallback;
    }
    return items.map((item, index) => `${index + 1}. ${item}`).join('\n');
  }

  private buildSceneInstructions(
    decomposeContext: DecomposeContext,
    extraInstructions?: string,
  ): SceneInstructionBundle {
    const chapterLine = decomposeContext.chapter
      ? `当前章节信息：第${decomposeContext.chapter.number}章《${decomposeContext.chapter.title}》（chapterId=${decomposeContext.chapter.id}）`
      : '当前章节信息：未指定章节（允许输出未绑定章节场景）。';
    const recentScenesBlock = this.formatList(
      decomposeContext.recentSceneSummaries,
      '（暂无历史场景）',
    );
    const settingBlock = this.formatList(
      decomposeContext.settingSummaries,
      '（暂无设定集摘要）',
    );
    const tagConstraintBlock = this.formatList(
      decomposeContext.tagTemplateConstraints,
      '（暂无标签模板约束）',
    );
    const schemaExample = [
      '{"scenes":[',
      '  {',
      '    "title":"旧港围捕",',
      '    "characters":["主角","追兵"],',
      '    "location":"旧港仓库",',
      '    "eventSkeleton":["设伏","爆发冲突","主角脱困"],',
      '    "tags":{"sceneType":"战斗"},',
      '    "chapterId":"",',
      '    "parentId":""',
      '  }',
      ']}',
    ].join('\n');
    const hardConstraints = [
      '硬性约束：',
      '1. 仅输出 JSON 对象，根节点必须是 {"scenes":[...]}。',
      '2. scenes 数量范围 3-8 条。',
      '3. 每条场景必须包含字段 title / characters / location / eventSkeleton / tags / chapterId / parentId。',
      '4. title 必须是非空字符串；eventSkeleton 必须是 2-6 条字符串；tags 必须是对象。',
      '5. chapterId 与 parentId 可为空字符串，但字段不可省略。',
      '6. 禁止输出解释文字、注释、Markdown 代码块或额外字段。',
    ];
    const extraInstructionBlock = extraInstructions?.trim()
      ? ['', '附加指令：', extraInstructions.trim()]
      : [];

    const sharedContext = [
      chapterLine,
      `已有场景数量：${decomposeContext.existingScenes.length}（避免与历史重复）`,
      '最近场景摘要：',
      recentScenesBlock,
      '设定集摘要：',
      settingBlock,
      '标签模板约束：',
      tagConstraintBlock,
      ...extraInstructionBlock,
    ];

    return {
      decompose: [
        '任务：拆解场景',
        ...hardConstraints,
        '输出示例：',
        schemaExample,
        ...sharedContext,
        '',
        '大纲原文：',
        decomposeContext.sourceOutline,
      ].join('\n'),
      transition: [
        '任务：补全场景转场',
        '基于上一阶段输出，补齐场景之间的因果、动作衔接与情绪递进。',
        ...hardConstraints,
        '输出示例：',
        schemaExample,
        ...sharedContext,
        '',
        '请输出修订后的完整 scenes JSON。',
      ].join('\n'),
      validation: [
        '任务：检验场景一致性',
        '核对上一阶段输出与大纲的一致性，修复缺字段、冲突、标签越界与重复场景。',
        ...hardConstraints,
        '输出示例：',
        schemaExample,
        ...sharedContext,
        '',
        '必须返回可直接落库的最终 scenes JSON。',
        '大纲原文：',
        decomposeContext.sourceOutline,
      ].join('\n'),
    };
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

  private resolveSceneStepRole(agent: Pick<AgentDefinition, 'name' | 'agentMdPath'>): keyof SceneInstructionBundle | null {
    const hint = `${agent.name} ${agent.agentMdPath}`;
    if (/拆解|decompose/i.test(hint)) {
      return 'decompose';
    }
    if (/过渡|transition/i.test(hint)) {
      return 'transition';
    }
    if (/检验|validation/i.test(hint)) {
      return 'validation';
    }
    return null;
  }

  private resolveStepInstructions(
    stepIndex: number,
    enabledSteps: WorkflowDefinition['steps'],
    stepOutputs: Record<string, string>,
    agent: AgentDefinition,
    context: Record<string, unknown>,
  ): string | undefined {
    const contextRecord = asRecord(context.context);
    const sceneInstructions = asRecord(contextRecord?.sceneInstructions ?? context.sceneInstructions);
    const role = this.resolveSceneStepRole(agent);
    const stageInstructions =
      role && sceneInstructions && typeof sceneInstructions[role] === 'string'
        ? (sceneInstructions[role] as string)
        : '';
    const fallbackInstructions =
      typeof context.instructions === 'string' && context.instructions.trim().length > 0
        ? context.instructions.trim()
        : '';
    let resolvedInstructions = stageInstructions || fallbackInstructions;
    if (!resolvedInstructions) {
      return undefined;
    }

    if ((role === 'transition' || role === 'validation') && stepIndex > 0) {
      const previousStepId = enabledSteps[stepIndex - 1]?.id;
      const previousOutput = previousStepId ? stepOutputs[previousStepId]?.trim() : '';
      if (previousOutput) {
        const previousLabel = role === 'transition' ? '上一阶段拆解输出' : '上一阶段过渡输出';
        resolvedInstructions = `${resolvedInstructions}\n\n${previousLabel}：\n${previousOutput}`;
      }
    }

    return resolvedInstructions;
  }

  private ensureRequiredSceneContext(
    workflow: WorkflowDefinition,
    mergedContext: Record<string, unknown>,
  ): void {
    if (workflow.kind !== 'scene') {
      return;
    }
    const contextRecord = asRecord(mergedContext.context);
    const sourceOutlineRaw = mergedContext.sourceOutline ?? contextRecord?.sourceOutline;
    const sourceOutline =
      typeof sourceOutlineRaw === 'string' && sourceOutlineRaw.trim().length > 0
        ? sourceOutlineRaw.trim()
        : '';
    const instructionsRaw = mergedContext.instructions;
    const hasInstructions =
      typeof instructionsRaw === 'string' && instructionsRaw.trim().length > 0;
    if (!sourceOutline && !hasInstructions) {
      throw new Error('缺少关键上下文：场景工作流需要 sourceOutline（大纲文本）或 instructions。');
    }
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
    const instructionsRawFromInput = globalContext.instructions ?? context.instructions;
    const explicitInstructions =
      typeof instructionsRawFromInput === 'string' && instructionsRawFromInput.trim().length > 0
        ? instructionsRawFromInput.trim()
        : '';
    let sceneInstructionBundle: SceneInstructionBundle | null = null;
    if (sourceOutline && this.contextBuilder) {
      const decomposeContext = this.contextBuilder.buildDecomposeContext(
        sourceOutline,
        workflow.projectId,
        chapterId,
      );
      context.sourceOutline = decomposeContext.sourceOutline;
      context.sceneChapter = decomposeContext.chapter;
      context.existingScenes = decomposeContext.existingScenes;
      context.recentSceneSummaries = decomposeContext.recentSceneSummaries;
      context.settingSummaries = decomposeContext.settingSummaries;
      context.tagTemplate = decomposeContext.tagTemplate;
      context.tagTemplateConstraints = decomposeContext.tagTemplateConstraints;
      sceneInstructionBundle = this.buildSceneInstructions(
        decomposeContext,
        explicitInstructions || undefined,
      );
      context.sceneInstructions = sceneInstructionBundle;
    } else if (sourceOutline) {
      context.sourceOutline = sourceOutline;
      const fallbackContext: DecomposeContext = {
        sourceOutline,
        chapter: undefined,
        existingScenes: [],
        recentSceneSummaries: [],
        settingSummaries: [],
        tagTemplate: [],
        tagTemplateConstraints: [],
      };
      sceneInstructionBundle = this.buildSceneInstructions(
        fallbackContext,
        explicitInstructions || undefined,
      );
      context.sceneInstructions = sceneInstructionBundle;
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
    if (sceneInstructionBundle) {
      merged.sceneInstructions = sceneInstructionBundle;
      merged.decomposeInstructions = sceneInstructionBundle.decompose;
      merged.transitionInstructions = sceneInstructionBundle.transition;
      merged.validationInstructions = sceneInstructionBundle.validation;
    }

    const instructionsRaw = merged.instructions;
    const hasInstructions =
      typeof instructionsRaw === 'string' && instructionsRaw.trim().length > 0;
    if (!hasInstructions) {
      if (sourceOutline) {
        merged.instructions = sceneInstructionBundle?.decompose ?? '';
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
  ): ScenePersistResult {
    const outputCandidates = Object.values(stepOutputs);
    const existing = this.store.getScenes(workflow.projectId);
    const dedupe = new Set(
      existing.map((scene) => sceneDedupeKey(scene.title, scene.chapterId, scene.eventSkeleton)),
    );
    let nextOrder = existing.reduce((maxOrder, scene) => Math.max(maxOrder, scene.order), -1) + 1;
    let savedCount = 0;
    let boundCount = 0;
    let unboundCount = 0;
    let fallbackBoundCount = 0;
    let parsedPayloadCount = 0;
    let parsedSceneCount = 0;
    let repairCount = 0;
    const parseErrors: string[] = [];
    const validationErrors: string[] = [];

    for (let outputIndex = 0; outputIndex < outputCandidates.length; outputIndex += 1) {
      const output = outputCandidates[outputIndex];
      const parseAttempt = parseJsonWithOneRepairRetry(output);
      if (!parseAttempt.parsed) {
        parseErrors.push(
          `输出 #${outputIndex + 1}：${parseAttempt.parseError ?? 'JSON 解析失败：未知错误。'}`,
        );
        continue;
      }
      parsedPayloadCount += 1;
      if (parseAttempt.repaired) {
        repairCount += 1;
      }

      const sceneList = extractSceneList(parseAttempt.parsed);
      if (sceneList.length === 0) {
        continue;
      }
      parsedSceneCount += sceneList.length;

      for (let i = 0; i < sceneList.length; i++) {
        const normalized = normalizeSceneDraft(sceneList[i], outputIndex + 1, i + 1);
        if (!normalized.scene) {
          if (normalized.error) {
            validationErrors.push(normalized.error);
          }
          continue;
        }
        const scene = normalized.scene;
        const hasSceneChapterId = typeof scene.chapterId === 'string' && scene.chapterId.trim().length > 0;
        const targetChapterId = hasSceneChapterId ? scene.chapterId : chapterId;
        const usedFallbackChapterBinding = !hasSceneChapterId && typeof chapterId === 'string' && chapterId.length > 0;
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
        if (targetChapterId) {
          boundCount += 1;
        } else {
          unboundCount += 1;
        }
        if (usedFallbackChapterBinding) {
          fallbackBoundCount += 1;
        }
      }
    }

    return {
      savedCount,
      boundCount,
      unboundCount,
      fallbackBoundCount,
      parsedPayloadCount,
      parsedSceneCount,
      repairCount,
      parseErrors,
      validationErrors,
    };
  }

  private summarizeErrorList(errors: string[], limit = 2): string {
    if (errors.length === 0) {
      return '';
    }
    const selected = errors.slice(0, limit).join('；');
    const remaining = errors.length - Math.min(errors.length, limit);
    return remaining > 0 ? `${selected}；另有 ${remaining} 条。` : selected;
  }

  private buildScenePersistFailureReason(result: ScenePersistResult): string {
    if (result.validationErrors.length > 0) {
      return `场景字段校验失败：${this.summarizeErrorList(result.validationErrors)}`;
    }
    if (result.parseErrors.length > 0) {
      return `场景 JSON 解析失败：${this.summarizeErrorList(result.parseErrors)}`;
    }
    if (result.parsedPayloadCount === 0) {
      return '场景 JSON 解析失败：所有步骤输出都不是可解析 JSON。';
    }
    if (result.parsedSceneCount === 0) {
      return '场景 JSON 解析成功，但未包含 scenes 或数组根节点场景数据。';
    }
    return '场景写入失败：未生成可保存的场景。';
  }

  private pickChapterPrimaryOutput(
    enabledSteps: WorkflowDefinition['steps'],
    stepOutputs: Record<string, string>,
  ): string | null {
    const configuredPrimary = enabledSteps.filter((step) => step.config?.primaryOutput === true);
    for (let i = configuredPrimary.length - 1; i >= 0; i--) {
      const output = stepOutputs[configuredPrimary[i].id];
      if (typeof output === 'string' && output.trim().length > 0) {
        return output.trim();
      }
    }

    for (let i = enabledSteps.length - 1; i >= 0; i--) {
      const output = stepOutputs[enabledSteps[i].id];
      if (typeof output !== 'string') {
        continue;
      }
      const trimmed = output.trim();
      if (!trimmed || isStructuredJsonPayload(trimmed)) {
        continue;
      }
      return trimmed;
    }

    for (let i = enabledSteps.length - 1; i >= 0; i--) {
      const output = stepOutputs[enabledSteps[i].id];
      if (typeof output !== 'string') {
        continue;
      }
      const trimmed = output.trim();
      if (trimmed) {
        return trimmed;
      }
    }

    return null;
  }

  async run(workflowId: string, globalContext: Record<string, unknown>, chapterId?: string): Promise<void> {
    let executionId: string | undefined;

    try {
      const workflow = this.store.getWorkflow(workflowId);
      const resolvedGlobalContext = this.enrichGlobalContext(workflow, globalContext, chapterId);
      this.ensureRequiredSceneContext(workflow, resolvedGlobalContext);
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
          control.skippedSteps.delete(step.id);
          this.emit({
            type: 'step:skipped',
            executionId: execution.id,
            stepId: step.id,
            agentId: step.agentId,
            reason: 'pre-marked',
          });
          this.store.saveExecutionStep({
            executionId: execution.id,
            stepId: step.id,
            agentId: step.agentId,
            status: 'skipped',
            order: i,
          });
          continue;
        }

        control.currentStepId = step.id;
        control.currentStepController = new AbortController();
        control.interruption = null;
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
        const scopedInstructions = this.resolveStepInstructions(
          i,
          enabledSteps,
          stepOutputs,
          agent,
          context,
        );
        if (typeof scopedInstructions === 'string') {
          context.instructions = scopedInstructions;
        }

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
            signal: control.currentStepController.signal,
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
          const interruption = this.getExecutionControl(execution.id).interruption;
          if (interruption?.stepId === step.id && interruption.type === 'skip') {
            control.skippedSteps.delete(step.id);
            this.emit({
              type: 'step:skipped',
              executionId: execution.id,
              stepId: step.id,
              agentId: step.agentId,
              reason: 'running-step',
            });
            this.store.saveExecutionStep({
              executionId: execution.id,
              stepId: step.id,
              agentId: step.agentId,
              status: 'skipped',
              order: i,
            });
            continue;
          }

          if (
            (interruption?.stepId === step.id && interruption.type === 'abort') ||
            (control.aborted && this.isAbortError(err))
          ) {
            const abortedMessage = '执行已终止：当前步骤已中断。';
            this.emit({
              type: 'step:failed',
              executionId: execution.id,
              stepId: step.id,
              error: abortedMessage,
            });
            this.store.saveExecutionStep({
              executionId: execution.id,
              stepId: step.id,
              agentId: step.agentId,
              status: 'failed',
              input: agent.promptTemplate,
              output: abortedMessage,
              order: i,
            });
            break;
          }

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
        } finally {
          if (control.currentStepId === step.id) {
            control.currentStepId = null;
            control.currentStepController = null;
          }
          const interruption = this.getExecutionControl(execution.id).interruption;
          if (interruption?.stepId === step.id) {
            control.interruption = null;
          }
        }
      }

      let finalStatus: 'failed' | 'completed' = control.aborted ? 'failed' : 'completed';
      let persistedScenes = 0;
      let persistedBoundScenes = 0;
      let persistedUnboundScenes = 0;
      let persistedFallbackBoundScenes = 0;
      let persistedSceneRepairCount = 0;
      let scenePersistFailureMessage = '';
      let scenePersistWarningMessage = '';
      let chapterContentPersistMessage = '';
      const sourceOutline = resolvedGlobalContext.sourceOutline;
      const sourceOutlineText = typeof sourceOutline === 'string' ? sourceOutline.trim() : '';
      const shouldRequireSceneOutput = sourceOutlineText.length > 0;
      if (finalStatus === 'completed') {
        const scenePersistResult = this.persistScenesFromOutputs(
          workflow,
          chapterId,
          sourceOutlineText,
          stepOutputs,
        );
        persistedScenes = scenePersistResult.savedCount;
        persistedBoundScenes = scenePersistResult.boundCount;
        persistedUnboundScenes = scenePersistResult.unboundCount;
        persistedFallbackBoundScenes = scenePersistResult.fallbackBoundCount;
        persistedSceneRepairCount = scenePersistResult.repairCount;
        if (scenePersistResult.validationErrors.length > 0 && persistedScenes > 0) {
          scenePersistWarningMessage = ` 场景字段校验跳过 ${scenePersistResult.validationErrors.length} 条。`;
        }
        if (shouldRequireSceneOutput && persistedScenes === 0) {
          finalStatus = 'failed';
          scenePersistFailureMessage = ` 场景写入失败：${this.buildScenePersistFailureReason(scenePersistResult)}`;
        }
        if (finalStatus === 'completed' && chapterId) {
          const chapterOutput = this.pickChapterPrimaryOutput(enabledSteps, stepOutputs);
          if (chapterOutput) {
            try {
              this.store.saveChapterContent(chapterId, chapterOutput);
              chapterContentPersistMessage = ' 章节正文已回写。';
            } catch (err) {
              const reason = err instanceof Error ? err.message : String(err);
              finalStatus = 'failed';
              chapterContentPersistMessage = ` 章节正文回写失败：${reason}`;
            }
          }
        }
      }
      this.store.saveExecution({ ...execution, status: finalStatus, completedAt: new Date().toISOString() });

      this.emit({
        type: 'workflow:complete',
        executionId: execution.id,
        chapterId,
        summary: `Workflow ${finalStatus}. ${Object.keys(stepOutputs).length} steps produced output. 已保存 ${persistedScenes} 条场景。 本次绑定章节 ${persistedBoundScenes} 条，未绑定章节 ${persistedUnboundScenes} 条。${persistedFallbackBoundScenes > 0 ? ` 其中 ${persistedFallbackBoundScenes} 条场景缺失 chapterId，已按入口章节兜底绑定。` : ''}${persistedUnboundScenes > 0 ? ` 其中 ${persistedUnboundScenes} 条未绑定章节，请尽快修复。` : ''}${persistedSceneRepairCount > 0 ? ` 解析修复 ${persistedSceneRepairCount} 次。` : ''}${scenePersistWarningMessage}${scenePersistFailureMessage}${chapterContentPersistMessage}`,
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
    if (control.currentStepId && control.currentStepController && !control.currentStepController.signal.aborted) {
      control.interruption = { type: 'abort', stepId: control.currentStepId };
      control.currentStepController.abort();
    }
    // Also resume if paused, so the loop can exit
    this.resume(executionId);
  }

  skip(executionId: string, stepId: string): void {
    const control = this.getExecutionControl(executionId);
    control.skippedSteps.add(stepId);
    if (
      control.currentStepId === stepId &&
      control.currentStepController &&
      !control.currentStepController.signal.aborted
    ) {
      control.interruption = { type: 'skip', stepId };
      control.currentStepController.abort();
    }
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
