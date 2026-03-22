import type { LLMProvider, ProviderConfig } from '@lisan/llm';
import { writeFile } from 'node:fs/promises';
import { StoreManager } from './store/store-manager.js';
import { AgentRegistry } from './agent/registry.js';
import { AgentExecutor } from './agent/executor.js';
import { WorkflowRuntime } from './workflow/runtime.js';
import { ContextBuilder } from './workflow/context-builder.js';
import { TruthManager } from './truth/truth-manager.js';
import type { TruthFiles } from './truth/types.js';

export interface EngineOptions {
  projectPath: string;
  provider: LLMProvider;
}

export interface EngineTruthApi {
  init: (projectId: string) => Promise<void>;
  read: (projectId: string) => Promise<TruthFiles>;
  update: (projectId: string, patch: Partial<TruthFiles>) => Promise<TruthFiles>;
}

const TRUTH_FILE_NAME: Record<keyof TruthFiles, string> = {
  currentState: 'current_state.md',
  pendingHooks: 'pending_hooks.md',
  characterMatrix: 'character_matrix.md',
};

export class Engine {
  readonly store: StoreManager;
  readonly agents: AgentRegistry;
  readonly executor: AgentExecutor;
  readonly runtime: WorkflowRuntime;
  readonly context: ContextBuilder;
  readonly truth: EngineTruthApi;
  private readonly truthManagers = new Map<string, TruthManager>();

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
    this.truth = {
      init: async (projectId) => {
        await this.getTruthManager(projectId).initTemplates();
      },
      read: async (projectId) => this.getTruthManager(projectId).read(),
      update: async (projectId, patch) => this.updateTruth(projectId, patch),
    };
  }

  private getTruthManager(projectId: string): TruthManager {
    this.store.getProject(projectId);
    const cached = this.truthManagers.get(projectId);
    if (cached) {
      return cached;
    }
    const manager = new TruthManager(this.store, projectId);
    this.truthManagers.set(projectId, manager);
    return manager;
  }

  private async updateTruth(projectId: string, patch: Partial<TruthFiles>): Promise<TruthFiles> {
    const manager = this.getTruthManager(projectId);
    await manager.initTemplates();
    const current = await manager.read();
    const next: TruthFiles = {
      currentState: patch.currentState ?? current.currentState,
      pendingHooks: patch.pendingHooks ?? current.pendingHooks,
      characterMatrix: patch.characterMatrix ?? current.characterMatrix,
    };
    await Promise.all(
      (Object.keys(TRUTH_FILE_NAME) as Array<keyof TruthFiles>).map((key) =>
        writeFile(
          this.store.resolveProjectPath(projectId, 'truth', TRUTH_FILE_NAME[key]),
          next[key],
          'utf-8',
        )),
    );
    return next;
  }

  close(): void {
    this.store.close();
  }
}
