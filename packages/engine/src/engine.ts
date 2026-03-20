import type { LLMProvider, ProviderConfig } from '@lisan/llm';
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
    const providerConfigResolver = (providerName: string): ProviderConfig => {
      const normalized = providerName.trim().toLowerCase();
      const config = this.store.getProvider(normalized);
      if (!config) {
        return {
          provider: normalized as ProviderConfig['provider'],
        };
      }
      return {
        provider: config.type,
        apiKey: config.apiKey,
        baseURL: config.baseUrl,
      };
    };
    this.executor = new AgentExecutor(opts.provider, undefined, providerConfigResolver);
    this.context = new ContextBuilder(this.store);
    this.runtime = new WorkflowRuntime(this.store, this.agents, this.executor, this.context);
  }

  close(): void {
    this.store.close();
  }
}
