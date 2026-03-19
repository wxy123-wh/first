export type WorkflowEvent =
  | { type: 'workflow:start'; workflowId: string; chapterId?: string }
  | { type: 'step:start'; stepId: string; agentId: string }
  | { type: 'step:progress'; stepId: string; chunk: string }
  | { type: 'step:complete'; stepId: string; output: string; tokens: number; duration: number }
  | { type: 'step:failed'; stepId: string; error: string }
  | { type: 'workflow:complete'; chapterId?: string; summary: string };

export type WorkflowEventHandler = (event: WorkflowEvent) => void;
