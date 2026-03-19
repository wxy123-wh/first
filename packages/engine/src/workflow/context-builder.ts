import type { StoreManager } from '../store/store-manager.js';
import type { Chapter, SceneCard, Entity, TagTemplateEntry } from '../types.js';

export interface ChapterContext {
  chapter: Chapter;
  scenes: SceneCard[];
  previousChapterTail: string;
  entities: Entity[];
}

export interface DecomposeContext {
  sourceOutline: string;
  existingScenes: SceneCard[];
  tagTemplate: TagTemplateEntry[];
}

const TAIL_CHARS = 500;

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

  buildDecomposeContext(sourceOutline: string, projectId: string): DecomposeContext {
    const existingScenes = this.store.getScenes(projectId);
    const project = this.store.getProject(projectId);
    return {
      sourceOutline,
      existingScenes,
      tagTemplate: project.sceneTagTemplate,
    };
  }
}
