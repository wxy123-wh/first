// NewAPI Provider 实现（OpenAI 兼容）

import type {
  LLMCallOptions,
  LLMCallResult,
  LLMProvider,
  LLMStreamChunk,
} from './types.js';
import { OpenAIProvider } from './openai-provider.js';

function pick(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    if (value && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function envValue(key: string): string | undefined {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  const value = env?.[key];
  return value && value.trim() ? value.trim() : undefined;
}

export class NewApiProvider implements LLMProvider {
  readonly name = 'newapi';
  private readonly delegate: OpenAIProvider;

  constructor(config?: { apiKey?: string; baseURL?: string }) {
    this.delegate = new OpenAIProvider({
      apiKey: pick(config?.apiKey, envValue('NEWAPI_API_KEY'), envValue('NEW_API_KEY')),
      baseURL: pick(config?.baseURL, envValue('NEWAPI_BASE_URL'), envValue('NEW_API_BASE_URL')),
    });
  }

  call(options: LLMCallOptions): Promise<LLMCallResult> {
    return this.delegate.call(options);
  }

  stream(options: LLMCallOptions): AsyncIterable<LLMStreamChunk> {
    return this.delegate.stream(options);
  }
}
