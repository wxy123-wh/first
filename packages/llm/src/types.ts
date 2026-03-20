// LLM Provider 统一接口定义

/** LLM 消息角色 */
export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** LLM 调用选项 */
export interface LLMCallOptions {
  model: string;
  messages: LLMMessage[];
  temperature?: number;
  maxTokens?: number;
  /** 超时时间（毫秒），默认 240_000 */
  timeoutMs?: number;
  signal?: AbortSignal;
}

/** 流式输出块 */
export interface LLMStreamChunk {
  text: string;
  finishReason?: 'stop' | 'length' | 'error';
}

/** LLM 调用结果（含用量统计） */
export interface LLMCallResult {
  text: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
}

/** LLM Provider 统一接口 */
export interface LLMProvider {
  readonly name: string;
  call(options: LLMCallOptions): Promise<LLMCallResult>;
  stream(options: LLMCallOptions): AsyncIterable<LLMStreamChunk>;
}

/** Provider 配置 */
export interface ProviderConfig {
  provider: 'anthropic' | 'openai' | 'newapi';
  apiKey?: string;
  baseURL?: string;
}
