export interface TagTemplateEntry {
  key: string;
  label: string;
  options?: string[];
}

export type ProviderType = "anthropic" | "openai" | "newapi";

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

export interface Project {
  id: string;
  name: string;
  basePath: string;
  sceneTagTemplate: TagTemplateEntry[];
  createdAt: string;
}

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

export type WorkflowKind = "scene" | "chapter";

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

export interface AgentDefinition {
  id: string;
  name: string;
  category: "builtin" | "custom";
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

export type ChapterStatus = "pending" | "drafting" | "rewriting" | "reviewing" | "done";

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

export type ExecutionStatus = "pending" | "running" | "completed" | "failed";
export type StepStatus = "pending" | "running" | "completed" | "failed" | "skipped";

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

export interface ExecutionDetail {
  execution: Execution;
  steps: ExecutionStep[];
}

export interface SidecarProjectOpenResult {
  opened: boolean;
  path: string;
  projectId?: string;
  projectName?: string;
}

export interface WorkflowRunOptions {
  workflowId: string;
  chapterId?: string;
  globalContext?: Record<string, unknown>;
}

export interface WorkflowRerunOptions {
  workflowId: string;
  chapterId?: string;
}

export interface WorkflowNotification {
  method: string;
  params: Record<string, unknown> | null;
  receivedAt: string;
}

export type AppTab =
  | "outline"
  | "scenes"
  | "chapters"
  | "workflows"
  | "agents"
  | "providers"
  | "executions"
  | "settings";

export interface CurrentProject {
  id: string;
  name: string;
  path: string;
}
