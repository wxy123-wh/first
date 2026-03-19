// Agent 接口定义

/** Agent 定义 */
export interface AgentDefinition {
  id: string;
  name: string;
  systemPrompt: string;
  model: string;
  timeoutMs?: number;
  temperature?: number;
}

/** Agent 输入 */
export interface AgentInput {
  userPrompt: string;
  /** 注入到 prompt 模板的键值对，替换 {{key}} */
  context?: Record<string, string>;
}

/** Agent 输出 */
export interface AgentOutput {
  content: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    costUsd?: number;
  };
  durationMs: number;
}

/** Agent 接口 */
export interface Agent {
  readonly definition: AgentDefinition;
  run(input: AgentInput): Promise<AgentOutput>;
}
