import type { StoreManager } from '../store/store-manager.js';
import { searchRagContext } from '../rag/sync-service.js';
import type {
  Chapter,
  SceneCard,
  Entity,
  TagTemplateEntry,
  DecomposeContext,
  RagReference,
} from '../types.js';

export interface ChapterContext {
  chapter: Chapter;
  scenes: SceneCard[];
  previousChapterTail: string;
  entities: Entity[];
  ragReferences: RagReference[];
  ragReferenceSummaries: string[];
}

export type { DecomposeContext } from '../types.js';

const TAIL_CHARS = 500;
const RECENT_SCENES_LIMIT = 8;
const SETTING_SUMMARIES_LIMIT = 6;
const CHAPTER_RAG_TOP_K = 3;
const DECOMPOSE_RAG_TOP_K = 4;

export interface RagContextRetriever {
  search(projectRoot: string, query: string, topK: number): RagReference[];
}

const defaultRagRetriever: RagContextRetriever = {
  search(projectRoot, query, topK) {
    return searchRagContext(projectRoot, query, topK);
  },
};

export class ContextBuilder {
  constructor(
    private store: StoreManager,
    private ragRetriever: RagContextRetriever = defaultRagRetriever,
  ) {}

  private buildChapterRagQuery(chapter: Chapter, scenes: SceneCard[], entities: Entity[]): string {
    const sceneTitles = scenes.map((scene) => scene.title.trim()).filter((title) => title.length > 0);
    const sceneBeats = scenes
      .flatMap((scene) => scene.eventSkeleton)
      .map((event) => event.trim())
      .filter((event) => event.length > 0)
      .slice(0, 12);
    const entityNames = entities
      .map((entity) => entity.name.trim())
      .filter((name) => name.length > 0)
      .slice(0, 10);

    return [
      `章节：第${chapter.number}章《${chapter.title}》`,
      sceneTitles.length > 0 ? `场景：${sceneTitles.join(' / ')}` : '',
      sceneBeats.length > 0 ? `事件骨架：${sceneBeats.join(' / ')}` : '',
      entityNames.length > 0 ? `关键实体：${entityNames.join(' / ')}` : '',
    ]
      .filter((line) => line.length > 0)
      .join('\n');
  }

  private buildDecomposeRagQuery(sourceOutline: string, chapter?: { number: number; title: string }): string {
    const chapterLine = chapter ? `章节：第${chapter.number}章《${chapter.title}》` : '';
    return [chapterLine, sourceOutline.trim()].filter((line) => line.length > 0).join('\n');
  }

  private retrieveRagReferences(projectId: string, query: string, topK: number): RagReference[] {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      return [];
    }

    try {
      const project = this.store.getProject(projectId);
      const references = this.ragRetriever.search(project.basePath, normalizedQuery, topK);
      return references.slice(0, topK);
    } catch {
      return [];
    }
  }

  private formatRagReferenceSummary(reference: RagReference): string {
    const summaryRaw = reference.abstract?.trim() || reference.excerpt?.trim() || '（无摘要）';
    const summary = summaryRaw.length > 160 ? `${summaryRaw.slice(0, 160)}...` : summaryRaw;
    const score = Number.isFinite(reference.score) ? reference.score.toFixed(2) : '0.00';
    return `${reference.source}（${reference.type}｜score=${score}）：${summary}`;
  }

  private buildRagSection(summaries: string[]): string {
    if (summaries.length === 0) {
      return '';
    }
    return [
      '【RAG检索参考】',
      ...summaries.map((summary, index) => `${index + 1}. ${summary}`),
    ].join('\n');
  }

  buildChapterContext(chapterId: string): ChapterContext {
    const chapter = this.store.getChapter(chapterId);
    const scenes = this.store.getScenes(chapter.projectId)
      .filter(s => s.chapterId === chapterId);
    const entities = this.store.queryEntities(chapter.projectId);

    // Find previous chapter by number
    let previousChapterTail = '';
    const chapters = this.store.getChapters(chapter.projectId);
    const sorted = chapters.sort((a, b) => a.number - b.number);
    const idx = sorted.findIndex(c => c.id === chapterId);
    if (idx > 0) {
      try {
        const content = this.store.getChapterContent(sorted[idx - 1].id);
        previousChapterTail = content.slice(-TAIL_CHARS);
      } catch {
        // No content yet for previous chapter
      }
    }

    const ragReferences = this.retrieveRagReferences(
      chapter.projectId,
      this.buildChapterRagQuery(chapter, scenes, entities),
      CHAPTER_RAG_TOP_K,
    );
    const ragReferenceSummaries = ragReferences.map((reference) => this.formatRagReferenceSummary(reference));
    const ragSection = this.buildRagSection(ragReferenceSummaries);
    const previousTailWithRag = ragSection
      ? [previousChapterTail, ragSection].filter((part) => part.length > 0).join('\n\n')
      : previousChapterTail;

    return {
      chapter,
      scenes,
      previousChapterTail: previousTailWithRag,
      entities,
      ragReferences,
      ragReferenceSummaries,
    };
  }

  private buildRecentSceneSummaries(
    existingScenes: SceneCard[],
    chapterTitleById: Map<string, string>,
  ): string[] {
    return existingScenes
      .slice(-RECENT_SCENES_LIMIT)
      .reverse()
      .map((scene) => {
        const chapterTitle = scene.chapterId
          ? chapterTitleById.get(scene.chapterId) ?? '未知章节'
          : '未绑定章节';
        const eventSummary = scene.eventSkeleton.slice(0, 3).join(' / ') || '（无事件骨架）';
        const tagSummary = Object.keys(scene.tags).length > 0
          ? Object.entries(scene.tags).map(([key, value]) => `${key}:${value}`).join('，')
          : '无';
        return `【${chapterTitle}】${scene.title}｜事件：${eventSummary}｜标签：${tagSummary}`;
      });
  }

  private buildSettingSummaries(projectId: string): string[] {
    return this.store
      .listSettings(projectId)
      .slice(0, SETTING_SUMMARIES_LIMIT)
      .map((setting) => {
        const tags = setting.tags.length > 0 ? setting.tags.join('、') : '无标签';
        return `${setting.title}（${tags}）：${setting.summary || '（无摘要）'}`;
      });
  }

  private buildTagTemplateConstraints(tagTemplate: TagTemplateEntry[]): string[] {
    return tagTemplate.map((entry) => {
      const options = Array.isArray(entry.options) && entry.options.length > 0
        ? `可选值：${entry.options.join(' / ')}`
        : '可选值：自由文本';
      return `${entry.label}（key=${entry.key}）必须在 tags 中给出；${options}`;
    });
  }

  buildDecomposeContext(sourceOutline: string, projectId: string, chapterId?: string): DecomposeContext {
    const existingScenes = this.store.getScenes(projectId);
    const project = this.store.getProject(projectId);
    const chapters = this.store.getChapters(projectId);
    const chapterTitleById = new Map(chapters.map((chapter) => [chapter.id, chapter.title]));
    const chapter = chapterId
      ? (() => {
        const selected = this.store.getChapter(chapterId);
        return {
          id: selected.id,
          number: selected.number,
          title: selected.title,
        };
      })()
      : undefined;
    const ragReferences = this.retrieveRagReferences(
      projectId,
      this.buildDecomposeRagQuery(sourceOutline, chapter),
      DECOMPOSE_RAG_TOP_K,
    );
    const ragReferenceSummaries = ragReferences.map((reference) => this.formatRagReferenceSummary(reference));
    const ragSettingSummaries = ragReferenceSummaries.map((summary) => `【RAG】${summary}`);
    const tagTemplateConstraints = this.buildTagTemplateConstraints(project.sceneTagTemplate);

    return {
      sourceOutline,
      chapter,
      existingScenes,
      recentSceneSummaries: this.buildRecentSceneSummaries(existingScenes, chapterTitleById),
      settingSummaries: [
        ...this.buildSettingSummaries(projectId),
        ...ragSettingSummaries,
      ],
      tagTemplate: project.sceneTagTemplate,
      tagTemplateConstraints,
      ragReferences,
      ragReferenceSummaries,
    };
  }
}
