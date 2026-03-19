import type { LLMProvider } from '@lisan/llm';
import { StoreManager } from './store/store-manager.js';
import { AgentRegistry } from './agent/registry.js';
import { AgentExecutor } from './agent/executor.js';
import { WorkflowRuntime } from './workflow/runtime.js';
import { ContextBuilder } from './workflow/context-builder.js';

export interface EngineOptions {
  projectPath: string;
  provider: LLMProvider;
}

export class Engine {
  readonly store: StoreManager;
  readonly agents: AgentRegistry;
  readonly executor: AgentExecutor;
  readonly runtime: WorkflowRuntime;
  readonly context: ContextBuilder;

  constructor(opts: EngineOptions) {
    this.store = new StoreManager(opts.projectPath);
    this.agents = new AgentRegistry(this.store);
    this.executor = new AgentExecutor(opts.provider);
    this.runtime = new WorkflowRuntime(this.store, this.agents, this.executor);
    this.context = new ContextBuilder(this.store);
  }

  close(): void {
    this.store.close();
  }
}
