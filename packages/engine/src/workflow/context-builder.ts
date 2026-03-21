import type { StoreManager } from '../store/store-manager.js';
import type { Chapter, SceneCard, Entity, TagTemplateEntry, DecomposeContext } from '../types.js';

export interface ChapterContext {
  chapter: Chapter;
  scenes: SceneCard[];
  previousChapterTail: string;
  entities: Entity[];
}

export type { DecomposeContext } from '../types.js';

const TAIL_CHARS = 500;
const RECENT_SCENES_LIMIT = 8;
const SETTING_SUMMARIES_LIMIT = 6;

export class ContextBuilder {
  constructor(private store: StoreManager) {}

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

    return { chapter, scenes, previousChapterTail, entities };
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
    const tagTemplateConstraints = this.buildTagTemplateConstraints(project.sceneTagTemplate);

    return {
      sourceOutline,
      chapter,
      existingScenes,
      recentSceneSummaries: this.buildRecentSceneSummaries(existingScenes, chapterTitleById),
      settingSummaries: this.buildSettingSummaries(projectId),
      tagTemplate: project.sceneTagTemplate,
      tagTemplateConstraints,
    };
  }
}
