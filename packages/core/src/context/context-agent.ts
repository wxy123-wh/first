// Context Agent — 读取 chapter-plan + scenes，组装 ContextPack，处理自主创角

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { LLMProvider } from '@lisan/llm';
import type { VectorStore } from '@lisan/rag';
import type { AgentDefinition } from '../agent/types.js';
import { AgentExecutor } from '../agent/executor.js';
import type { SceneDefinition, GeneratedCharacter, ContextPack } from './types.js';
import type { EntityGraph, Entity } from '../state/entity-graph.js';
import type { BookConfig } from '../plugin/types.js';
import { TruthManager } from '../truth/truth-manager.js';

export interface ContextAgentDeps {
  projectRoot: string;
  bookConfig: BookConfig;
  provider: LLMProvider;
  vectorStore: VectorStore | null;
  entityGraph: EntityGraph | null;
  agentDefinition: AgentDefinition;
}

/**
 * Context Agent
 * 1. 读取 chapter-plan.md 解析章节信息
 * 2. 读取 scenes.md 解析场景列表
 * 3. 从 RAG 检索相关设定
 * 4. 从实体图谱获取角色卡
 * 5. 按需自主创角
 * 6. 组装 ContextPack
 */
export class ContextAgent {
  private readonly deps: ContextAgentDeps;
  private readonly executor: AgentExecutor;

  constructor(deps: ContextAgentDeps) {
    this.deps = deps;
    this.executor = new AgentExecutor(deps.agentDefinition, deps.provider);
  }

  async buildContextPack(chapterNumber: number): Promise<ContextPack> {
    // 1. 读取章节规划
    const chapterPlan = await this.readChapterPlan(chapterNumber);

    // 2. 读取场景树
    const scenes = await this.readScenes(chapterNumber);

    // 3. 读取上章尾部
    const prevChapterTail = await this.readPrevChapterTail(chapterNumber);

    // 4. 从 RAG 检索相关设定
    const settingRefs = await this.fetchSettingRefs(chapterPlan, scenes);

    // 5. 获取角色卡
    const characterCards = await this.fetchCharacterCards(scenes);

    // 6. 自主创角
    const generatedCharacters = await this.generateCharacters(chapterNumber, scenes);

    // 7. 读取真相文件摘要
    const truthSummary = await this.fetchTruthSummary();

    return {
      chapterNumber,
      chapterTitle: chapterPlan.title,
      emotionTask: chapterPlan.emotionTask,
      emotionCurve: chapterPlan.emotionCurve,
      thrillType: chapterPlan.thrillType,
      endHook: chapterPlan.endHook,
      scenes,
      prevChapterTail,
      settingRefs,
      characterCards,
      generatedCharacters,
      truthSummary,
    };
  }

  /** 读取并解析 chapter-plan.md 中指定章节的信息 */
  private async readChapterPlan(chapterNumber: number): Promise<ChapterPlanInfo> {
    const planPath = join(this.deps.projectRoot, '大纲', 'chapter-plan.md');
    const content = await readFile(planPath, 'utf-8');
    return parseChapterPlan(content, chapterNumber);
  }

  /** 读取并解析 scenes.md 中指定章节的场景列表 */
  private async readScenes(chapterNumber: number): Promise<SceneDefinition[]> {
    const scenesPath = join(this.deps.projectRoot, '场景树', 'scenes.md');
    const content = await readFile(scenesPath, 'utf-8');
    return parseScenes(content, chapterNumber);
  }

  /** 读取上一章最后 500 字 */
  private async readPrevChapterTail(chapterNumber: number): Promise<string> {
    if (chapterNumber <= 1) return '';
    const prevPath = join(
      this.deps.projectRoot,
      '正文',
      `chapter-${String(chapterNumber - 1).padStart(3, '0')}.md`,
    );
    try {
      const content = await readFile(prevPath, 'utf-8');
      return content.slice(-500);
    } catch {
      return '';
    }
  }

  /** 从 RAG 检索与本章相关的设定摘要 */
  private async fetchSettingRefs(
    plan: ChapterPlanInfo,
    scenes: SceneDefinition[],
  ): Promise<string> {
    if (!this.deps.vectorStore) return '';

    const queryText = [
      plan.title,
      plan.emotionTask,
      ...scenes.map((s) => s.title),
      ...scenes.flatMap((s) => s.characters),
    ].join(' ');

    const results = await this.deps.vectorStore.search({
      text: queryText,
      topK: 5,
      mode: 'hybrid',
      filter: { type: ['setting', 'reference'] },
    });

    return results.map((r) => r.document.metadata.abstract ?? r.document.content.slice(0, 200)).join(String.fromCharCode(10));
  }

  /** 从实体图谱获取本章涉及角色的角色卡 */
  private async fetchCharacterCards(scenes: SceneDefinition[]): Promise<string> {
    if (!this.deps.entityGraph) return '';

    const characterIds = new Set(scenes.flatMap((s) => s.characters));
    const cards: string[] = [];

    for (const id of characterIds) {
      const entity = this.deps.entityGraph.getById(id);
      if (entity) {
        cards.push(formatEntityCard(entity));
      }
    }

    return cards.join(String.fromCharCode(10) + '---' + String.fromCharCode(10));
  }

  /** 自主创角：对允许创角的场景，调用 LLM 生成配角/路人 */
  private async generateCharacters(
    chapterNumber: number,
    scenes: SceneDefinition[],
  ): Promise<GeneratedCharacter[]> {
    const generated: GeneratedCharacter[] = [];

    for (const scene of scenes) {
      if (!scene.allowNewCharacters) continue;

      const hints = scene.newCharacterHints ?? scene.emotionTask;
      const output = await this.executor.run({
        userPrompt: [
          `场景: ${scene.title}`,
          `情绪任务: ${scene.emotionTask}`,
          `爽点类型: ${scene.thrillType ?? '无'}`,
          `创角提示: ${hints}`,
          `已有角色: ${scene.characters.join(', ')}`,
          '',
          '请为此场景创建一个配角或路人角色。以 JSON 格式返回:',
          '{"name","appearance","identity","speechStyle","relationToProtagonist","persistence"}',
          'persistence 取值: chapter(仅本章)/arc(本篇)/permanent(永久)',
        ].join(String.fromCharCode(10)),
        context: {
          instructions: `你需要为场景"${scene.title}"创建一个新角色。角色应服务于情绪任务"${scene.emotionTask}"。`,
        },
      });

      try {
        const charData = extractJson(output.content);
        if (charData) {
          const character: GeneratedCharacter = {
            id: `gen-${chapterNumber}-${scene.id}-${Date.now()}`,
            name: charData.name ?? '未命名',
            appearance: charData.appearance ?? '',
            identity: charData.identity ?? '',
            speechStyle: charData.speechStyle ?? '',
            relationToProtagonist: charData.relationToProtagonist ?? '',
            persistence: (charData.persistence as GeneratedCharacter['persistence']) ?? 'chapter',
            createdInChapter: chapterNumber,
            createdInScene: scene.id,
          };

          generated.push(character);

          // 持久化：arc/permanent 写入实体图谱
          if (character.persistence !== 'chapter' && this.deps.entityGraph) {
            const entity: Entity = {
              id: character.id,
              name: character.name,
              type: 'character',
              metadata: {
                appearance: character.appearance,
                identity: character.identity,
                speechStyle: character.speechStyle,
                relationToProtagonist: character.relationToProtagonist,
                createdInScene: character.createdInScene,
              },
              createdInChapter: chapterNumber,
              persistence: character.persistence,
              needsReview: character.persistence === 'permanent',
            };
            this.deps.entityGraph.create(entity);
          }
        }
      } catch {
        // JSON 解析失败，跳过此场景的创角
      }
    }

    return generated;
  }

  /** 读取真相文件摘要 */
  private async fetchTruthSummary(): Promise<string> {
    try {
      const truthManager = new TruthManager(this.deps.projectRoot);
      return await truthManager.buildSummary();
    } catch {
      return '';
    }
  }
}

// --- 内部解析工具 ---

interface ChapterPlanInfo {
  title: string;
  emotionTask: string;
  emotionCurve: string;
  thrillType: string;
  endHook: string;
}

/** 从 chapter-plan.md 解析指定章节信息 */
function parseChapterPlan(content: string, chapterNumber: number): ChapterPlanInfo {
  const nl = String.fromCharCode(10);
  const sections = content.split(new RegExp(`#{1,3}\s*第?${chapterNumber}[章节]`, 'i'));

  const section = sections.length > 1 ? sections[1].split(/#{1,3}\s*第?\d+[章节]/)[0] : content;

  const getField = (label: string): string => {
    const match = section.match(new RegExp(`${label}[：:]\s*(.+)`));
    return match?.[1]?.trim() ?? '';
  };

  return {
    title: getField('标题') || getField('章节名') || `第${chapterNumber}章`,
    emotionTask: getField('情绪任务') || getField('情绪'),
    emotionCurve: getField('情绪曲线') || getField('曲线'),
    thrillType: getField('爽点类型') || getField('爽点'),
    endHook: getField('章末钩子') || getField('钩子') || getField('悬念'),
  };
}

/** 从 scenes.md 解析指定章节的场景列表 */
function parseScenes(content: string, chapterNumber: number): SceneDefinition[] {
  const nl = String.fromCharCode(10);
  // 按章节分割
  const chapterPattern = new RegExp(`#{1,3}\s*第?${chapterNumber}[章节]`, 'i');
  const sections = content.split(chapterPattern);
  if (sections.length < 2) return [];

  const chapterSection = sections[1].split(/#{1,3}\s*第?\d+[章节]/)[0];

  // 按场景分割（## 或 ### 开头）
  const sceneBlocks = chapterSection.split(/#{2,3}\s+场景/).filter((b) => b.trim());

  return sceneBlocks.map((block, index) => {
    const getField = (label: string): string => {
      const match = block.match(new RegExp(`${label}[：:]\s*(.+)`));
      return match?.[1]?.trim() ?? '';
    };

    const getListField = (label: string): string[] => {
      const match = block.match(new RegExp(`${label}[：:]\s*(.+)`));
      return match?.[1]?.split(/[,，、]/).map((s) => s.trim()).filter(Boolean) ?? [];
    };

    return {
      id: `scene-${chapterNumber}-${index + 1}`,
      title: getField('标题') || `场景${index + 1}`,
      type: (getField('类型') || 'core') as SceneDefinition['type'],
      scale: (getField('规模') || 'medium') as SceneDefinition['scale'],
      emotionTask: getField('情绪任务') || getField('情绪'),
      thrillType: getField('爽点类型') || null,
      phase: (getField('阶段') || 'buildup') as SceneDefinition['phase'],
      characters: getListField('角色') || getListField('人物'),
      allowNewCharacters: getField('允许创角') === '是' || getField('允许创角') === 'true',
      newCharacterHints: getField('创角提示') || undefined,
      location: getField('地点') || getField('场所'),
      eventSkeleton: getListField('事件') || getListField('骨架'),
      cameraFocus: getField('镜头焦点') || getField('焦点') || '',
    } satisfies SceneDefinition;
  });
}

/** 格式化实体为角色卡文本 */
function formatEntityCard(entity: Entity): string {
  const meta = entity.metadata;
  const lines = [`【${entity.name}】(${entity.type})`];
  for (const [key, value] of Object.entries(meta)) {
    if (value !== undefined && value !== null && value !== '') {
      lines.push(`  ${key}: ${String(value)}`);
    }
  }
  return lines.join(String.fromCharCode(10));
}

/** 从 LLM 输出中提取 JSON 对象 */
function extractJson(text: string): Record<string, string> | null {
  const match = text.match(/\{[\s\S]*?\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]) as Record<string, string>;
  } catch {
    return null;
  }
}
