import { create } from 'zustand';
import type { Project, Execution } from '../types/lisan';

interface LisanStore {
  projects: Project[];
  currentProject: Project | null;
  setProjects: (projects: Project[]) => void;
  setCurrentProject: (project: Project | null) => void;
  executions: Execution[];
  setExecutions: (executions: Execution[]) => void;
  isLoading: boolean;
  setIsLoading: (loading: boolean) => void;
}

export const useLisanStore = create<LisanStore>((set) => ({
  projects: [],
  currentProject: null,
  setProjects: (projects) => set({ projects }),
  setCurrentProject: (project) => set({ currentProject: project }),
  executions: [],
  setExecutions: (executions) => set({ executions }),
  isLoading: false,
  setIsLoading: (loading) => set({ isLoading: loading })
}));
