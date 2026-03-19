// Provider 工厂函数

import type { LLMProvider, ProviderConfig } from './types.js';
import { AnthropicProvider } from './anthropic-provider.js';
import { OpenAIProvider } from './openai-provider.js';

/**
 * 根据配置创建 LLM Provider 实例
 */
export function createProvider(config: ProviderConfig): LLMProvider {
  switch (config.provider) {
    case 'anthropic':
      return new AnthropicProvider({
        apiKey: config.apiKey,
        baseURL: config.baseURL,
      });
    case 'openai':
      return new OpenAIProvider({
        apiKey: config.apiKey,
        baseURL: config.baseURL,
      });
    default:
      throw new Error(`不支持的 provider: ${config.provider as string}`);
  }
}
