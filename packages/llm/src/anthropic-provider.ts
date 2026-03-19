// Anthropic Provider 实现（基于 Vercel AI SDK）

import { createAnthropic } from '@ai-sdk/anthropic';
import { generateText, streamText } from 'ai';
import type {
  LLMCallOptions,
  LLMCallResult,
  LLMProvider,
  LLMStreamChunk,
} from './types.js';
import { withRetry } from './retry.js';

export class AnthropicProvider implements LLMProvider {
  readonly name = 'anthropic';
  private readonly client: ReturnType<typeof createAnthropic>;

  constructor(config?: { apiKey?: string; baseURL?: string }) {
    this.client = createAnthropic({
      apiKey: config?.apiKey,
      baseURL: config?.baseURL,
    });
  }

  async call(options: LLMCallOptions): Promise<LLMCallResult> {
    const model = this.client(options.model);
    const timeoutMs = options.timeoutMs ?? 240_000;

    const result = await withRetry(() =>
      generateText({
        model,
        messages: options.messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
        temperature: options.temperature,
        maxTokens: options.maxTokens,
        abortSignal: options.signal ?? AbortSignal.timeout(timeoutMs),
      }),
    );

    return {
      text: result.text,
      usage: {
        inputTokens: result.usage.promptTokens,
        outputTokens: result.usage.completionTokens,
      },
    };
  }

  async *stream(options: LLMCallOptions): AsyncIterable<LLMStreamChunk> {
    const model = this.client(options.model);
    const timeoutMs = options.timeoutMs ?? 240_000;

    const result = streamText({
      model,
      messages: options.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      temperature: options.temperature,
      maxTokens: options.maxTokens,
      abortSignal: options.signal ?? AbortSignal.timeout(timeoutMs),
    });

    for await (const chunk of result.textStream) {
      yield { text: chunk };
    }
  }
}
