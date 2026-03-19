import { invoke } from "@tauri-apps/api/core";
import type { Project, Execution, ExecutionDetail } from "../types/lisan";
import { parseExecutionTrace } from "../lib/jsonl-parser";

export interface CreateProjectInput {
  name: string;
  plugin?: string;
  llmConfig?: {
    orchestrator?: { provider: string; model: string; temperature: number };
    worker?: { provider: string; model: string; temperature: number };
  };
}

export interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size?: number;
}

export interface FileBrowseResult {
  entries?: FileEntry[];
  content?: string;
  is_dir: boolean;
}

export const api = {
  listProjects: () => invoke<Project[]>("list_projects"),
  createProject: (data: CreateProjectInput) =>
    invoke<Project>("create_project", { data }),
  deleteProject: (id: string) => invoke<void>("delete_project", { id }),
  getConfig: (id: string) => invoke<string>("get_config", { id }),
  saveConfig: (id: string, content: string) =>
    invoke<void>("save_config", { id, content }),
  browseFiles: (id: string, subpath: string) =>
    invoke<FileBrowseResult>("browse_files", { id, subpath }),
  getExecutions: (id: string) =>
    invoke<Execution[]>("get_executions", { id }),
  getExecutionDetail: async (id: string, execId: string): Promise<ExecutionDetail> => {
    const jsonlContent = await invoke<string>("get_execution_detail", { id, execId });
    return parseExecutionTrace(jsonlContent);
  },
};
