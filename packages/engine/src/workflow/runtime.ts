import { nanoid } from 'nanoid';
import type { WorkflowEventHandler } from './events.js';
import type { StoreManager } from '../store/store-manager.js';
import type { AgentRegistry } from '../agent/registry.js';
import type { AgentExecutor } from '../agent/executor.js';

export class WorkflowRuntime {
  private paused = false;
  private aborted = false;
  private pauseResolver: (() => void) | null = null;
  private skippedSteps = new Set<string>();
  private handlers: WorkflowEventHandler[] = [];

  constructor(
    private store: StoreManager,
    private agentRegistry: AgentRegistry,
    private agentExecutor: AgentExecutor,
  ) {}

  on(handler: WorkflowEventHandler): void {
    this.handlers.push(handler);
  }

  private emit(event: Parameters<WorkflowEventHandler>[0]): void {
    for (const handler of this.handlers) handler(event);
  }

  async run(workflowId: string, globalContext: Record<string, unknown>, chapterId?: string): Promise<void> {
    this.paused = false;
    this.aborted = false;

    const workflow = this.store.getWorkflow(workflowId);
    const enabledSteps = workflow.steps.filter(s => s.enabled);

    // Create execution record
    const execution = this.store.saveExecution({
      projectId: workflow.projectId,
      chapterId,
      workflowId,
      status: 'running',
      startedAt: new Date().toISOString(),
    });

    this.emit({ type: 'workflow:start', workflowId, chapterId });

    const stepOutputs: Record<string, string> = {};

    for (let i = 0; i < enabledSteps.length; i++) {
      // Check abort
      if (this.aborted) break;

      // Check pause — wait until resumed
      if (this.paused) {
        await new Promise<void>(resolve => {
          this.pauseResolver = resolve;
        });
      }

      // Check abort again after resume
      if (this.aborted) break;

      const step = enabledSteps[i];

      // Check if step is marked for skip
      if (this.skippedSteps.has(step.id)) {
        this.store.saveExecutionStep({
          executionId: execution.id,
          stepId: step.id,
          agentId: step.agentId,
          status: 'skipped',
          order: i,
        });
        continue;
      }

      this.emit({ type: 'step:start', stepId: step.id, agentId: step.agentId });

      // Load agent definition
      const agents = this.agentRegistry.list();
      const agent = agents.find(a => a.id === step.agentId);
      if (!agent) {
        const error = `Agent not found: ${step.agentId}`;
        this.emit({ type: 'step:failed', stepId: step.id, error });
        this.store.saveExecutionStep({
          executionId: execution.id,
          stepId: step.id,
          agentId: step.agentId,
          status: 'failed',
          order: i,
        });
        break;
      }

      // Build context with previous step outputs + global context
      const context: Record<string, unknown> = {
        ...globalContext,
        prev: i > 0 ? { output: stepOutputs[enabledSteps[i - 1].id] } : undefined,
        step: stepOutputs,
      };

      try {
        const agentMd = this.agentRegistry.getAgentMd(agent.id);
        const model = step.config?.model ?? agent.model;
        const temperature = step.config?.temperature ?? agent.temperature;
        const maxTokens = step.config?.maxTokens ?? agent.maxTokens;

        const result = await this.agentExecutor.execute({
          agentMd,
          promptTemplate: agent.promptTemplate,
          context,
          model,
          temperature,
          maxTokens,
        });

        stepOutputs[step.id] = result.text;

        this.emit({
          type: 'step:complete',
          stepId: step.id,
          output: result.text,
          tokens: result.tokens,
          duration: result.duration,
        });

        this.store.saveExecutionStep({
          executionId: execution.id,
          stepId: step.id,
          agentId: step.agentId,
          status: 'completed',
          input: agent.promptTemplate,
          output: result.text,
          tokens: result.tokens,
          duration: result.duration,
          order: i,
        });
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        this.emit({ type: 'step:failed', stepId: step.id, error });
        this.store.saveExecutionStep({
          executionId: execution.id,
          stepId: step.id,
          agentId: step.agentId,
          status: 'failed',
          order: i,
        });
        // Mark execution as failed
        this.store.saveExecution({ ...execution, status: 'failed', completedAt: new Date().toISOString() });
        return;
      }
    }

    const finalStatus = this.aborted ? 'failed' : 'completed';
    this.store.saveExecution({ ...execution, status: finalStatus, completedAt: new Date().toISOString() });

    this.emit({
      type: 'workflow:complete',
      chapterId,
      summary: `Workflow ${finalStatus}. ${Object.keys(stepOutputs).length} steps produced output.`,
    });
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
    if (this.pauseResolver) {
      this.pauseResolver();
      this.pauseResolver = null;
    }
  }

  abort(): void {
    this.aborted = true;
    // Also resume if paused, so the loop can exit
    this.resume();
  }

  skip(stepId: string): void {
    this.skippedSteps.add(stepId);
  }

  async rerun(executionId: string, fromStepId: string): Promise<void> {
    const detail = this.store.getExecutionDetail(executionId);
    const execution = detail.execution;
    const workflow = this.store.getWorkflow(execution.workflowId);
    const enabledSteps = workflow.steps.filter(s => s.enabled);

    // Find the index of the target step
    const fromIndex = enabledSteps.findIndex(s => s.id === fromStepId);
    if (fromIndex === -1) throw new Error(`Step not found in workflow: ${fromStepId}`);

    // Collect outputs from steps before fromIndex
    const stepOutputs: Record<string, string> = {};
    for (let i = 0; i < fromIndex; i++) {
      const existingStep = detail.steps.find(s => s.stepId === enabledSteps[i].id);
      if (existingStep?.output) stepOutputs[enabledSteps[i].id] = existingStep.output;
    }

    // Mark execution as running again
    this.store.saveExecution({ ...execution, status: 'running', completedAt: undefined });

    // Re-execute from fromIndex
    for (let i = fromIndex; i < enabledSteps.length; i++) {
      const step = enabledSteps[i];
      const agents = this.agentRegistry.list();
      const agent = agents.find(a => a.id === step.agentId);
      if (!agent) throw new Error(`Agent not found: ${step.agentId}`);

      const context: Record<string, unknown> = {
        prev: i > 0 ? { output: stepOutputs[enabledSteps[i - 1].id] } : undefined,
        step: stepOutputs,
      };

      const agentMd = this.agentRegistry.getAgentMd(agent.id);
      const result = await this.agentExecutor.execute({
        agentMd,
        promptTemplate: agent.promptTemplate,
        context,
        model: step.config?.model ?? agent.model,
        temperature: step.config?.temperature ?? agent.temperature,
        maxTokens: step.config?.maxTokens ?? agent.maxTokens,
      });

      stepOutputs[step.id] = result.text;

      // Update or insert execution step
      const existingStep = detail.steps.find(s => s.stepId === step.id);
      this.store.saveExecutionStep({
        id: existingStep?.id,
        executionId,
        stepId: step.id,
        agentId: step.agentId,
        status: 'completed',
        input: agent.promptTemplate,
        output: result.text,
        tokens: result.tokens,
        duration: result.duration,
        order: i,
      });
    }

    this.store.saveExecution({ ...execution, status: 'completed', completedAt: new Date().toISOString() });
  }
}
