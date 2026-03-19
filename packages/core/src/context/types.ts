// Context Agent 接口定义

/** 场景定义 */
export interface SceneDefinition {
  id: string;
  title: string;
  type: 'core' | 'buildup' | 'release' | 'transition' | 'aftermath';
  scale: 'large' | 'medium' | 'small';
  emotionTask: string;
  thrillType: string | null;
  phase: 'suppress' | 'release' | 'buildup' | 'aftermath' | 'transition';
  characters: string[];
  /** 是否允许 Context Agent 自主创角 */
  allowNewCharacters: boolean;
  newCharacterHints?: string;
  location: string;
  eventSkeleton: string[];
  cameraFocus: string;
}

/** 自主创建的角色卡 */
export interface GeneratedCharacter {
  id: string;
  name: string;
  appearance: string;
  identity: string;
  speechStyle: string;
  relationToProtagonist: string;
  persistence: 'chapter' | 'arc' | 'permanent';
  createdInChapter: number;
  createdInScene: string;
}

/** 创作执行包 */
export interface ContextPack {
  chapterNumber: number;
  chapterTitle: string;
  emotionTask: string;
  emotionCurve: string;
  thrillType: string;
  endHook: string;
  scenes: SceneDefinition[];
  /** 上章最后 500 字 */
  prevChapterTail: string;
  /** 按需检索的设定摘要 */
  settingRefs: string;
  /** 大纲角色卡摘要 */
  characterCards: string;
  /** 本章自主创建的配角/路人 */
  generatedCharacters: GeneratedCharacter[];
  /** 真相文件摘要（世界状态+伏笔+角色矩阵） */
  truthSummary?: string;
}
