// AgentExecutor 模板注入 + 用量统计 单元测试

import { describe, it, expect, vi } from 'vitest';
import { AgentExecutor } from './executor.js';
import type { AgentDefinition } from './types.js';
import type { LLMProvider, LLMCallResult, LLMStreamChunk } from '@lisan/llm';

function createMockProvider(response: Partial<LLMCallResult> = {}): LLMProvider {
  return {
    name: 'mock',
    call: vi.fn().mockResolvedValue({
      text: response.text ?? '生成的内容',
      usage: {
        inputTokens: response.usage?.inputTokens ?? 100,
        outputTokens: response.usage?.outputTokens ?? 200,
      },
    }),
    stream: vi.fn() as () => AsyncIterable<LLMStreamChunk>,
  };
}

const baseDefinition: AgentDefinition = {
  id: 'test-agent',
  name: '测试 Agent',
  role: 'worker',
  model: 'gpt-4o',
  systemPrompt: '你是一个写作助手。当前章节：{{chapter}}，场景：{{scene}}',
  temperature: 0.7,
  timeoutMs: 60_000,
};

describe('AgentExecutor', () => {
  it('模板注入 {{key}} 替换', async () => {
    const provider = createMockProvider();
    const executor = new AgentExecutor(baseDefinition, provider);

    await executor.run({
      userPrompt: '写一段打斗场景',
      context: { chapter: '第三章', scene: '天台对决' },
    });

    const callArgs = (provider.call as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArgs.messages[0].content).toBe(
      '你是一个写作助手。当前章节：第三章，场景：天台对决',
    );
  });

  it('无 context 时不替换模板', async () => {
    const provider = createMockProvider();
    const executor = new AgentExecutor(baseDefinition, provider);

    await executor.run({ userPrompt: '写一段打斗场景' });

    const callArgs = (provider.call as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArgs.messages[0].content).toBe(baseDefinition.systemPrompt);
  });

  it('返回 token 用量统计', async () => {
    const provider = createMockProvider({
      text: '输出文本',
      usage: { inputTokens: 500, outputTokens: 1000 },
    });
    const executor = new AgentExecutor(baseDefinition, provider);

    const output = await executor.run({ userPrompt: '测试' });

    expect(output.usage.inputTokens).toBe(500);
    expect(output.usage.outputTokens).toBe(1000);
    expect(output.content).toBe('输出文本');
  });

  it('记录执行耗时', async () => {
    const provider = createMockProvider();
    const executor = new AgentExecutor(baseDefinition, provider);

    const output = await executor.run({ userPrompt: '测试' });

    expect(output.durationMs).toBeGreaterThanOrEqual(0);
    expect(typeof output.durationMs).toBe('number');
  });

  it('传递正确的 model 和 temperature', async () => {
    const provider = createMockProvider();
    const executor = new AgentExecutor(baseDefinition, provider);

    await executor.run({ userPrompt: '测试' });

    const callArgs = (provider.call as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArgs.model).toBe('gpt-4o');
    expect(callArgs.temperature).toBe(0.7);
    expect(callArgs.timeoutMs).toBe(60_000);
  });

  it('多个模板变量全部替换', async () => {
    const def: AgentDefinition = {
      ...baseDefinition,
      systemPrompt: '角色：{{role}}，情绪：{{emotion}}，场景：{{scene}}',
    };
    const provider = createMockProvider();
    const executor = new AgentExecutor(def, provider);

    await executor.run({
      userPrompt: '测试',
      context: { role: '主角', emotion: '愤怒', scene: '决战' },
    });

    const callArgs = (provider.call as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArgs.messages[0].content).toBe('角色：主角，情绪：愤怒，场景：决战');
  });
});
