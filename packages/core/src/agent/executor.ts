// Agent 执行器实现

import type { LLMProvider } from '@lisan/llm';
import type { AgentDefinition, AgentInput, AgentOutput, Agent } from './types.js';

/** 将 context 键值对注入 prompt 模板 */
function injectTemplate(template: string, context: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(context)) {
    result = result.replaceAll(`{{${key}}}`, value);
  }
  return result;
}

/** Agent 执行器 */
export class AgentExecutor implements Agent {
  readonly definition: AgentDefinition;
  private readonly provider: LLMProvider;

  constructor(definition: AgentDefinition, provider: LLMProvider) {
    this.definition = definition;
    this.provider = provider;
  }

  async run(input: AgentInput): Promise<AgentOutput> {
    const startTime = Date.now();

    // 模板注入
    const systemPrompt = input.context
      ? injectTemplate(this.definition.systemPrompt, input.context)
      : this.definition.systemPrompt;

    const result = await this.provider.call({
      model: this.definition.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: input.userPrompt },
      ],
      temperature: this.definition.temperature,
      timeoutMs: this.definition.timeoutMs ?? 240_000,
    });

    const durationMs = Date.now() - startTime;

    return {
      content: result.text,
      usage: {
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
      },
      durationMs,
    };
  }
}
