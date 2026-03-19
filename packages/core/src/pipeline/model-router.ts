// 模型路由 — 按 Agent 角色选择 LLM Provider

import type { LLMProvider, ProviderConfig } from '@lisan/llm';
import { createProvider } from '@lisan/llm';
import type { AgentDefinition } from '../agent/types.js';

/** 模型路由配置 */
export interface ModelRouterConfig {
  orchestrator: ProviderConfig & { model: string; temperature?: number };
  worker: ProviderConfig & { model: string; temperature?: number };
}

/**
 * 模型路由器
 * 根据 AgentDefinition 中的 model 字段匹配编排器或执行器 provider
 */
export class ModelRouter {
  private readonly orchestratorProvider: LLMProvider;
  private readonly workerProvider: LLMProvider;
  private readonly config: ModelRouterConfig;

  constructor(config: ModelRouterConfig) {
    this.config = config;
    this.orchestratorProvider = createProvider(config.orchestrator);
    this.workerProvider = createProvider(config.worker);
  }

  /** 根据 AgentDefinition 获取对应的 provider */
  getProvider(definition: AgentDefinition): LLMProvider {
    if (definition.model === this.config.orchestrator.model) {
      return this.orchestratorProvider;
    }
    return this.workerProvider;
  }

  /** 获取编排器 provider */
  getOrchestrator(): LLMProvider {
    return this.orchestratorProvider;
  }

  /** 获取执行器 provider */
  getWorker(): LLMProvider {
    return this.workerProvider;
  }
}
