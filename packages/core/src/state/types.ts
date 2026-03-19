// 项目状态接口定义

/** 章节记录 */
export interface ChapterRecord {
  number: number;
  title: string;
  status: 'pending' | 'drafting' | 'rewriting' | 'reviewing' | 'done';
  filePath: string;
  wordCount?: number;
  completedAt?: string;
  gitCommit?: string;
}

/** 项目状态 */
export interface ProjectState {
  version: string;
  bookId: string;
  currentChapter: number;
  currentArc: string;
  chapters: Record<number, ChapterRecord>;
  lastUpdated: string;
}

/** 状态管理器接口 */
export interface StateManager {
  load(): Promise<ProjectState>;
  save(state: ProjectState): Promise<void>;
  updateChapter(number: number, patch: Partial<ChapterRecord>): Promise<void>;
}
