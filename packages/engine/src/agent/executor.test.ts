import { describe, it, expect, vi } from 'vitest';
import { AgentExecutor } from './executor.js';
import type { LLMProvider } from '@lisan/llm';
import type { ProviderConfig } from '@lisan/llm';

describe('AgentExecutor', () => {
  it('calls LLM with system (agent.md) and user (rendered template)', async () => {
    const mockProvider: LLMProvider = {
      name: 'mock',
      call: vi.fn().mockResolvedValue({
        text: 'Generated chapter content',
        usage: { inputTokens: 100, outputTokens: 400 },
      }),
      stream: vi.fn(),
    };
    const executor = new AgentExecutor(mockProvider);
    const result = await executor.execute({
      agentMd: 'You are a draft writer.',
      promptTemplate: 'Write based on: {{context.scenes}}',
      context: { context: { scenes: 'Scene A: Fight' } },
      model: 'gpt-4o',
    });
    expect(result.text).toBe('Generated chapter content');
    expect(result.tokens).toBe(500);
    expect(mockProvider.call).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: 'You are a draft writer.' },
          { role: 'user', content: 'Write based on: Scene A: Fight' },
        ],
      })
    );
  });

  it('passes temperature and maxTokens to provider', async () => {
    const mockProvider: LLMProvider = {
      name: 'mock',
      call: vi.fn().mockResolvedValue({
        text: 'output',
        usage: { inputTokens: 50, outputTokens: 50 },
      }),
      stream: vi.fn(),
    };
    const executor = new AgentExecutor(mockProvider);
    await executor.execute({
      agentMd: 'system',
      promptTemplate: 'user prompt',
      context: {},
      model: 'gpt-4o',
      temperature: 0.9,
      maxTokens: 4000,
    });
    expect(mockProvider.call).toHaveBeenCalledWith(
      expect.objectContaining({
        temperature: 0.9,
        maxTokens: 4000,
      })
    );
  });

  it('uses override provider when provided in execute options', async () => {
    const defaultProvider: LLMProvider = {
      name: 'openai',
      call: vi.fn().mockResolvedValue({
        text: 'default-output',
        usage: { inputTokens: 1, outputTokens: 1 },
      }),
      stream: vi.fn(),
    };
    const newApiProvider: LLMProvider = {
      name: 'newapi',
      call: vi.fn().mockResolvedValue({
        text: 'newapi-output',
        usage: { inputTokens: 2, outputTokens: 2 },
      }),
      stream: vi.fn(),
    };

    const executor = new AgentExecutor(defaultProvider, (providerName) =>
      providerName === 'newapi' ? newApiProvider : defaultProvider,
    );

    const result = await executor.execute({
      agentMd: 'system',
      promptTemplate: 'user',
      context: {},
      model: 'gpt-4o',
      provider: 'newapi',
    });

    expect(result.text).toBe('newapi-output');
    expect(newApiProvider.call).toHaveBeenCalledTimes(1);
    expect(defaultProvider.call).toHaveBeenCalledTimes(0);
  });

  it('builds provider from resolver config for custom provider id', async () => {
    const call = vi.fn().mockResolvedValue({
      text: 'custom-output',
      usage: { inputTokens: 3, outputTokens: 5 },
    });
    const stream = vi.fn();
    const resolver = vi.fn(
      (providerName: string): ProviderConfig => ({
        provider: providerName === 'corp-proxy' ? 'newapi' : 'openai',
        apiKey: providerName === 'corp-proxy' ? 'proxy-key' : undefined,
        baseURL: providerName === 'corp-proxy' ? 'https://proxy.example.com/v1' : undefined,
      }),
    );
    const providerFactory = vi.fn(
      (_providerName: string, config: ProviderConfig): LLMProvider => ({
        name: config.provider,
        call,
        stream,
      }),
    );

    const executor = new AgentExecutor(null, providerFactory, resolver);
    const result = await executor.execute({
      agentMd: 'system',
      promptTemplate: 'user',
      context: {},
      model: 'gpt-4o',
      provider: 'corp-proxy',
    });

    expect(result.text).toBe('custom-output');
    expect(resolver).toHaveBeenCalledWith('corp-proxy');
    expect(providerFactory).toHaveBeenCalledWith(
      'corp-proxy',
      expect.objectContaining({
        provider: 'newapi',
        apiKey: 'proxy-key',
        baseURL: 'https://proxy.example.com/v1',
      }),
    );
  });

  it('passes abort signal to provider call options', async () => {
    const mockProvider: LLMProvider = {
      name: 'mock',
      call: vi.fn().mockResolvedValue({
        text: 'output',
        usage: { inputTokens: 5, outputTokens: 7 },
      }),
      stream: vi.fn(),
    };

    const executor = new AgentExecutor(mockProvider);
    const controller = new AbortController();
    await executor.execute({
      agentMd: 'system',
      promptTemplate: 'user',
      context: {},
      model: 'gpt-4o',
      signal: controller.signal,
    });

    expect(mockProvider.call).toHaveBeenCalledWith(
      expect.objectContaining({
        signal: controller.signal,
      }),
    );
  });
});
