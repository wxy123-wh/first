// === Project ===
export interface Project {
  id: string;
  name: string;
  basePath: string;
  sceneTagTemplate: TagTemplateEntry[];
  createdAt: string;
}

export interface TagTemplateEntry {
  key: string;
  label: string;
  options?: string[];
}

export interface SceneGenerationChapterContext {
  id: string;
  number: number;
  title: string;
}

export interface DecomposeContext {
  sourceOutline: string;
  chapter?: SceneGenerationChapterContext;
  existingScenes: SceneCard[];
  recentSceneSummaries: string[];
  settingSummaries: string[];
  tagTemplate: TagTemplateEntry[];
  tagTemplateConstraints: string[];
}

export type ProviderType = 'anthropic' | 'openai' | 'newapi';

export interface ProviderDefinition {
  id: string;
  name: string;
  type: ProviderType;
  model: string;
  baseUrl?: string;
  apiKey?: string;
  createdAt: string;
  updatedAt: string;
}

// === Workflow ===
export type WorkflowKind = 'scene' | 'chapter';

export interface WorkflowDefinition {
  id: string;
  projectId: string;
  name: string;
  description: string;
  kind?: WorkflowKind;
  steps: WorkflowStep[];
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowStep {
  id: string;
  order: number;
  agentId: string;
  enabled: boolean;
  config?: StepConfigOverride;
}

export interface StepConfigOverride {
  temperature?: number;
  maxTokens?: number;
  model?: string;
  provider?: string;
  primaryOutput?: boolean;
}

// === Agent ===
export interface AgentDefinition {
  id: string;
  name: string;
  category: 'builtin' | 'custom';
  provider: string;
  model: string;
  temperature: number;
  maxTokens?: number;
  agentMdPath: string;
  promptTemplate: string;
  inputSchema: string[];
  createdAt: string;
  updatedAt: string;
}

// === Scene ===
export interface SceneCard {
  id: string;
  projectId: string;
  chapterId?: string;
  parentId?: string;
  order: number;
  title: string;
  characters: string[];
  location: string;
  eventSkeleton: string[];
  tags: Record<string, string>;
  sourceOutline: string;
  createdAt: string;
  updatedAt: string;
}

// === Chapter ===
export type ChapterStatus = 'pending' | 'drafting' | 'rewriting' | 'reviewing' | 'done';
export type ChapterDeleteStrategy = 'detach';

export interface Chapter {
  id: string;
  projectId: string;
  number: number;
  title: string;
  status: ChapterStatus;
  workflowId?: string;
  contentPath: string;
  createdAt: string;
  updatedAt: string;
}

// === Execution ===
export type ExecutionStatus = 'pending' | 'running' | 'completed' | 'failed';
export type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export interface Execution {
  id: string;
  projectId: string;
  chapterId?: string;
  workflowId: string;
  status: ExecutionStatus;
  startedAt: string;
  completedAt?: string;
}

export interface ExecutionStep {
  id: string;
  executionId: string;
  stepId: string;
  agentId: string;
  status: StepStatus;
  input?: string;
  output?: string;
  tokens?: number;
  duration?: number;
  order: number;
}

// === Entity ===
export interface Entity {
  id: string;
  projectId: string;
  type: 'character' | 'location' | 'item' | 'event';
  name: string;
  data: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

// === Settings Library ===
export interface SettingDocumentSummary {
  id: string;
  projectId: string;
  title: string;
  tags: string[];
  summary: string;
  filePath: string;
  createdAt: string;
  updatedAt: string;
}

export interface SettingDocument extends SettingDocumentSummary {
  content: string;
}
