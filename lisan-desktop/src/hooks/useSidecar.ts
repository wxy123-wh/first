import { useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  AgentDefinition,
  Chapter,
  Execution,
  ExecutionDetail,
  ProviderDefinition,
  Project,
  RagSyncStartResult,
  RagSyncStatus,
  SceneCard,
  SettingDocument,
  SettingDocumentSummary,
  SidecarProjectOpenResult,
  WorkflowDefinition,
  WorkflowRerunOptions,
  WorkflowRunOptions,
} from "@/types/engine";

type WorkflowInput = Omit<WorkflowDefinition, "id" | "createdAt" | "updatedAt"> &
  Partial<Pick<WorkflowDefinition, "id" | "createdAt" | "updatedAt">>;
type SceneInput = Omit<SceneCard, "id" | "createdAt" | "updatedAt"> &
  Partial<Pick<SceneCard, "id" | "createdAt" | "updatedAt">>;
type AgentInput = Omit<AgentDefinition, "id" | "createdAt" | "updatedAt"> &
  Partial<Pick<AgentDefinition, "id" | "createdAt" | "updatedAt">> & {
    agentMd?: string;
  };
type ProviderInput = Omit<ProviderDefinition, "createdAt" | "updatedAt"> &
  Partial<Pick<ProviderDefinition, "createdAt" | "updatedAt">>;
type ChapterInput = Omit<Chapter, "id" | "createdAt" | "updatedAt"> &
  Partial<Pick<Chapter, "id" | "createdAt" | "updatedAt">>;
type ChapterDeleteStrategy = "detach";
type SettingInput = Pick<SettingDocument, "projectId" | "title" | "tags" | "summary" | "content"> &
  Partial<Pick<SettingDocument, "id">>;
type ProjectUpdatePatch = Partial<Pick<Project, "name" | "sceneTagTemplate">>;

async function invokeCommand<T>(command: string, payload?: Record<string, unknown>): Promise<T> {
  return invoke<T>(command, payload);
}

export interface SidecarApi {
  projectOpen: (path: string) => Promise<SidecarProjectOpenResult>;
  projectGet: (id: string) => Promise<Project>;
  projectUpdate: (id: string, patch: ProjectUpdatePatch) => Promise<Project>;
  outlineGet: () => Promise<string>;
  outlineSave: (content: string) => Promise<void>;
  workflowList: (projectId: string) => Promise<WorkflowDefinition[]>;
  workflowSave: (workflow: WorkflowInput) => Promise<WorkflowDefinition>;
  workflowRun: (options: WorkflowRunOptions) => Promise<{ started: boolean }>;
  workflowPause: (executionId: string) => Promise<void>;
  workflowResume: (executionId: string) => Promise<void>;
  workflowSkip: (executionId: string, stepId: string) => Promise<void>;
  workflowRerun: (options: WorkflowRerunOptions) => Promise<void>;
  workflowAbort: (executionId: string) => Promise<void>;
  agentList: () => Promise<AgentDefinition[]>;
  agentSave: (agent: AgentInput) => Promise<AgentDefinition>;
  agentDelete: (id: string) => Promise<void>;
  agentGetMd: (id: string) => Promise<string>;
  agentSaveMd: (id: string, content: string) => Promise<void>;
  providerList: () => Promise<ProviderDefinition[]>;
  providerSave: (provider: ProviderInput) => Promise<ProviderDefinition>;
  providerDelete: (id: string) => Promise<void>;
  sceneList: (projectId: string) => Promise<SceneCard[]>;
  sceneSave: (scene: SceneInput) => Promise<SceneCard>;
  sceneDelete: (id: string) => Promise<void>;
  sceneReorder: (ids: string[]) => Promise<void>;
  chapterList: (projectId: string) => Promise<Chapter[]>;
  chapterSave: (chapter: ChapterInput) => Promise<Chapter>;
  chapterCreate: (chapter: ChapterInput) => Promise<Chapter>;
  chapterDelete: (id: string, strategy?: ChapterDeleteStrategy) => Promise<void>;
  chapterGetContent: (id: string) => Promise<string>;
  chapterSaveContent: (id: string, content: string) => Promise<void>;
  settingList: (projectId: string) => Promise<SettingDocumentSummary[]>;
  settingGet: (id: string) => Promise<SettingDocument>;
  settingSave: (setting: SettingInput) => Promise<SettingDocument>;
  settingDelete: (id: string) => Promise<void>;
  executionList: (projectId: string) => Promise<Execution[]>;
  executionDetail: (id: string) => Promise<ExecutionDetail>;
  ragSync: () => Promise<RagSyncStartResult>;
  ragStatus: () => Promise<RagSyncStatus>;
}

export function useSidecar(): SidecarApi {
  const projectOpen = useCallback((path: string) => {
    return invokeCommand<SidecarProjectOpenResult>("project_open", { path });
  }, []);

  const projectGet = useCallback((id: string) => {
    return invokeCommand<Project>("project_get", { id });
  }, []);

  const projectUpdate = useCallback((id: string, patch: ProjectUpdatePatch) => {
    return invokeCommand<Project>("project_update", { id, patch });
  }, []);

  const outlineGet = useCallback(async () => {
    const result = await invokeCommand<string | { content?: string }>("outline_get");
    if (typeof result === "string") {
      return result;
    }
    return result.content ?? "";
  }, []);

  const outlineSave = useCallback((content: string) => {
    return invokeCommand<void>("outline_save", { content });
  }, []);

  const workflowList = useCallback((projectId: string) => {
    return invokeCommand<WorkflowDefinition[]>("workflow_list", { projectId });
  }, []);

  const workflowSave = useCallback((workflow: WorkflowInput) => {
    return invokeCommand<WorkflowDefinition>("workflow_save", { workflow });
  }, []);

  const workflowRun = useCallback((options: WorkflowRunOptions) => {
    return invokeCommand<{ started: boolean }>("workflow_run", {
      workflowId: options.workflowId,
      chapterId: options.chapterId,
      globalContext: options.globalContext,
    });
  }, []);

  const workflowPause = useCallback((executionId: string) => {
    return invokeCommand<void>("workflow_pause", { executionId });
  }, []);
  const workflowResume = useCallback((executionId: string) => {
    return invokeCommand<void>("workflow_resume", { executionId });
  }, []);
  const workflowSkip = useCallback((executionId: string, stepId: string) => {
    return invokeCommand<void>("workflow_skip", { executionId, stepId });
  }, []);
  const workflowRerun = useCallback((options: WorkflowRerunOptions) => {
    return invokeCommand<void>("workflow_rerun", {
      workflowId: options.workflowId,
      chapterId: options.chapterId,
    });
  }, []);
  const workflowAbort = useCallback((executionId: string) => {
    return invokeCommand<void>("workflow_abort", { executionId });
  }, []);

  const agentList = useCallback(() => invokeCommand<AgentDefinition[]>("agent_list"), []);
  const agentSave = useCallback((agent: AgentInput) => {
    return invokeCommand<AgentDefinition>("agent_save", { agent });
  }, []);
  const agentDelete = useCallback((id: string) => invokeCommand<void>("agent_delete", { id }), []);
  const agentGetMd = useCallback(async (id: string) => {
    const result = await invokeCommand<string | { content?: string }>("agent_get_md", { id });
    if (typeof result === "string") {
      return result;
    }
    return result.content ?? "";
  }, []);
  const agentSaveMd = useCallback((id: string, content: string) => {
    return invokeCommand<void>("agent_save_md", { id, content });
  }, []);

  const providerList = useCallback(() => invokeCommand<ProviderDefinition[]>("provider_list"), []);
  const providerSave = useCallback((provider: ProviderInput) => {
    return invokeCommand<ProviderDefinition>("provider_save", { provider });
  }, []);
  const providerDelete = useCallback((id: string) => {
    return invokeCommand<void>("provider_delete", { id });
  }, []);

  const sceneList = useCallback((projectId: string) => {
    return invokeCommand<SceneCard[]>("scene_list", { projectId });
  }, []);
  const sceneSave = useCallback((scene: SceneInput) => {
    return invokeCommand<SceneCard>("scene_save", { scene });
  }, []);
  const sceneDelete = useCallback((id: string) => invokeCommand<void>("scene_delete", { id }), []);
  const sceneReorder = useCallback((ids: string[]) => {
    return invokeCommand<void>("scene_reorder", { ids });
  }, []);

  const chapterList = useCallback((projectId: string) => {
    return invokeCommand<Chapter[]>("chapter_list", { projectId });
  }, []);
  const chapterSave = useCallback((chapter: ChapterInput) => {
    return invokeCommand<Chapter>("chapter_save", { chapter });
  }, []);
  const chapterCreate = useCallback((chapter: ChapterInput) => {
    return invokeCommand<Chapter>("chapter_create", { chapter });
  }, []);
  const chapterDelete = useCallback((id: string, strategy: ChapterDeleteStrategy = "detach") => {
    return invokeCommand<void>("chapter_delete", { id, strategy });
  }, []);
  const chapterGetContent = useCallback(async (id: string) => {
    const result = await invokeCommand<string | { content?: string }>("chapter_get_content", { id });
    if (typeof result === "string") {
      return result;
    }
    return result.content ?? "";
  }, []);
  const chapterSaveContent = useCallback((id: string, content: string) => {
    return invokeCommand<void>("chapter_save_content", { id, content });
  }, []);

  const settingList = useCallback((projectId: string) => {
    return invokeCommand<SettingDocumentSummary[]>("setting_list", { projectId });
  }, []);
  const settingGet = useCallback((id: string) => {
    return invokeCommand<SettingDocument>("setting_get", { id });
  }, []);
  const settingSave = useCallback((setting: SettingInput) => {
    return invokeCommand<SettingDocument>("setting_save", { setting });
  }, []);
  const settingDelete = useCallback((id: string) => {
    return invokeCommand<void>("setting_delete", { id });
  }, []);

  const executionList = useCallback((projectId: string) => {
    return invokeCommand<Execution[]>("execution_list", { projectId });
  }, []);
  const executionDetail = useCallback((id: string) => {
    return invokeCommand<ExecutionDetail>("execution_detail", { id });
  }, []);

  const ragSync = useCallback(() => {
    return invokeCommand<RagSyncStartResult>("rag_sync");
  }, []);

  const ragStatus = useCallback(() => {
    return invokeCommand<RagSyncStatus>("rag_status");
  }, []);

  return useMemo(
    () => ({
      projectOpen,
      projectGet,
      projectUpdate,
      outlineGet,
      outlineSave,
      workflowList,
      workflowSave,
      workflowRun,
      workflowPause,
      workflowResume,
      workflowSkip,
      workflowRerun,
      workflowAbort,
      agentList,
      agentSave,
      agentDelete,
      agentGetMd,
      agentSaveMd,
      providerList,
      providerSave,
      providerDelete,
      sceneList,
      sceneSave,
      sceneDelete,
      sceneReorder,
      chapterList,
      chapterSave,
      chapterCreate,
      chapterDelete,
      chapterGetContent,
      chapterSaveContent,
      settingList,
      settingGet,
      settingSave,
      settingDelete,
      executionList,
      executionDetail,
      ragSync,
      ragStatus,
    }),
    [
      projectOpen,
      projectGet,
      projectUpdate,
      outlineGet,
      outlineSave,
      workflowList,
      workflowSave,
      workflowRun,
      workflowPause,
      workflowResume,
      workflowSkip,
      workflowRerun,
      workflowAbort,
      agentList,
      agentSave,
      agentDelete,
      agentGetMd,
      agentSaveMd,
      providerList,
      providerSave,
      providerDelete,
      sceneList,
      sceneSave,
      sceneDelete,
      sceneReorder,
      chapterList,
      chapterSave,
      chapterCreate,
      chapterDelete,
      chapterGetContent,
      chapterSaveContent,
      settingList,
      settingGet,
      settingSave,
      settingDelete,
      executionList,
      executionDetail,
      ragSync,
      ragStatus,
    ],
  );
}
