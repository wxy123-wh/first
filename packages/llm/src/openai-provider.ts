// OpenAI Provider 实现（基于 Vercel AI SDK）

import { createOpenAI } from '@ai-sdk/openai';
import { generateText, streamText } from 'ai';
import type {
  LLMCallOptions,
  LLMCallResult,
  LLMProvider,
  LLMStreamChunk,
} from './types.js';
import { withRetry } from './retry.js';

export class OpenAIProvider implements LLMProvider {
  readonly name = 'openai';
  private readonly client: ReturnType<typeof createOpenAI>;

  constructor(config?: { apiKey?: string; baseURL?: string }) {
    this.client = createOpenAI({
      apiKey: config?.apiKey,
      baseURL: config?.baseURL,
      compatibility: 'strict',
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
