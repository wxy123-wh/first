import { create } from "zustand";
import type { AppTab, CurrentProject, WorkflowNotification } from "@/types/engine";

interface SidecarState {
  isRunning: boolean;
  projectPath: string | null;
  lastError: string | null;
}

interface AppState {
  currentProject: CurrentProject | null;
  activeTab: AppTab;
  sidecar: SidecarState;
  workflowEvents: WorkflowNotification[];
  setProject: (project: CurrentProject | null) => void;
  setActiveTab: (tab: AppTab) => void;
  setSidecarStatus: (patch: Partial<SidecarState>) => void;
  pushWorkflowEvent: (event: WorkflowNotification) => void;
  clearWorkflowEvents: () => void;
}

const MAX_WORKFLOW_EVENTS = 200;

const initialSidecarState: SidecarState = {
  isRunning: false,
  projectPath: null,
  lastError: null,
};

export const useAppStore = create<AppState>((set) => ({
  currentProject: null,
  activeTab: "outline",
  sidecar: initialSidecarState,
  workflowEvents: [],
  setProject: (project) => set({ currentProject: project }),
  setActiveTab: (tab) => set({ activeTab: tab }),
  setSidecarStatus: (patch) =>
    set((state) => ({
      sidecar: {
        ...state.sidecar,
        ...patch,
      },
    })),
  pushWorkflowEvent: (event) =>
    set((state) => ({
      workflowEvents: [...state.workflowEvents, event].slice(-MAX_WORKFLOW_EVENTS),
    })),
  clearWorkflowEvents: () => set({ workflowEvents: [] }),
}));

export type { AppState };
