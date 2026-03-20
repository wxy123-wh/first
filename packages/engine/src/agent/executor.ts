import { renderTemplate } from '../template/engine.js';
import { createProvider } from '@lisan/llm';
import type { LLMProvider, ProviderConfig } from '@lisan/llm';

export interface ExecuteOptions {
  agentMd: string;
  promptTemplate: string;
  context: Record<string, unknown>;
  provider?: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
}

export interface ExecuteResult {
  text: string;
  tokens: number;
  duration: number;
}

type ProviderFactory = (providerName: string, config: ProviderConfig) => LLMProvider;
type ProviderConfigResolver = (providerName: string) => ProviderConfig;

function envValue(...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = process.env[key];
    if (value && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function resolveProviderApiKey(providerName: string): string | undefined {
  switch (providerName) {
    case 'openai':
      return envValue('OPENAI_API_KEY');
    case 'anthropic':
      return envValue('ANTHROPIC_API_KEY');
    case 'newapi':
      return envValue('NEWAPI_API_KEY', 'NEW_API_KEY');
    default:
      return undefined;
  }
}

function resolveProviderBaseUrl(providerName: string): string | undefined {
  switch (providerName) {
    case 'openai':
      return envValue('OPENAI_BASE_URL');
    case 'anthropic':
      return envValue('ANTHROPIC_BASE_URL');
    case 'newapi':
      return envValue('NEWAPI_BASE_URL', 'NEW_API_BASE_URL');
    default:
      return undefined;
  }
}

function defaultProviderConfigResolver(providerName: string): ProviderConfig {
  const normalized = providerName.trim().toLowerCase();
  return {
    provider: normalized as ProviderConfig['provider'],
    apiKey: resolveProviderApiKey(normalized),
    baseURL: resolveProviderBaseUrl(normalized),
  };
}

export class AgentExecutor {
  private readonly providerCache = new Map<string, LLMProvider>();
  private readonly defaultProvider: LLMProvider | null;
  private readonly providerFactory: ProviderFactory;
  private readonly providerConfigResolver: ProviderConfigResolver;

  constructor(
    defaultProvider: LLMProvider | null,
    providerFactory?: ProviderFactory,
    providerConfigResolver?: ProviderConfigResolver,
  ) {
    this.defaultProvider = defaultProvider;
    this.providerConfigResolver = providerConfigResolver ?? defaultProviderConfigResolver;
    if (providerFactory) {
      this.providerFactory = providerFactory;
    } else if (defaultProvider) {
      // Keep backward compatibility for tests and injected single-provider runtimes.
      this.providerFactory = () => defaultProvider;
    } else {
      this.providerFactory = (_providerName, config) => createProvider(config);
    }

    if (defaultProvider?.name) {
      this.providerCache.set(defaultProvider.name.toLowerCase(), defaultProvider);
    }
  }

  private resolveProvider(providerName?: string): LLMProvider {
    const normalized = providerName?.trim().toLowerCase();
    if (!normalized) {
      if (this.defaultProvider) {
        return this.defaultProvider;
      }
      return this.getOrCreateProvider('openai');
    }

    if (this.defaultProvider && normalized === this.defaultProvider.name.toLowerCase()) {
      return this.defaultProvider;
    }

    return this.getOrCreateProvider(normalized);
  }

  private getOrCreateProvider(providerName: string): LLMProvider {
    const cached = this.providerCache.get(providerName);
    if (cached) {
      return cached;
    }
    const config = this.providerConfigResolver(providerName);
    const provider = this.providerFactory(providerName, config);
    this.providerCache.set(providerName, provider);
    return provider;
  }

  clearProviderCache(providerName?: string): void {
    const normalized = providerName?.trim().toLowerCase();
    if (!normalized) {
      this.providerCache.clear();
      if (this.defaultProvider?.name) {
        this.providerCache.set(this.defaultProvider.name.toLowerCase(), this.defaultProvider);
      }
      return;
    }
    this.providerCache.delete(normalized);
  }

  async execute(opts: ExecuteOptions): Promise<ExecuteResult> {
    const prompt = renderTemplate(opts.promptTemplate, opts.context);
    const provider = this.resolveProvider(opts.provider);
    const start = Date.now();
    const result = await provider.call({
      model: opts.model,
      messages: [
        { role: 'system', content: opts.agentMd },
        { role: 'user', content: prompt },
      ],
      temperature: opts.temperature,
      maxTokens: opts.maxTokens,
    });
    return {
      text: result.text,
      tokens: result.usage.inputTokens + result.usage.outputTokens,
      duration: Date.now() - start,
    };
  }
}
