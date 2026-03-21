export type WorkflowEvent =
  | { type: 'workflow:start'; executionId: string; workflowId: string; chapterId?: string }
  | { type: 'step:start'; executionId: string; stepId: string; agentId: string }
  | { type: 'step:progress'; executionId: string; stepId: string; chunk: string }
  | { type: 'step:complete'; executionId: string; stepId: string; output: string; tokens: number; duration: number }
  | { type: 'step:skipped'; executionId: string; stepId: string; agentId: string; reason?: string }
  | { type: 'step:failed'; executionId: string; stepId: string; error: string }
  | { type: 'workflow:complete'; executionId: string; chapterId?: string; summary: string };

export type WorkflowEventHandler = (event: WorkflowEvent) => void;
