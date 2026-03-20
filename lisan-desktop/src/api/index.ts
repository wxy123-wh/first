import { invoke } from "@tauri-apps/api/core";
import type { Project } from "../types/lisan";

export interface CreateProjectInput {
  name: string;
  plugin?: string;
  llmConfig?: {
    orchestrator?: { provider: string; model: string; temperature: number };
    worker?: { provider: string; model: string; temperature: number };
  };
}

export const api = {
  listProjects: () => invoke<Project[]>("list_projects"),
  createProject: (data: CreateProjectInput) =>
    invoke<Project>("create_project", { data }),
  deleteProject: (id: string) => invoke<void>("delete_project", { id }),
};
