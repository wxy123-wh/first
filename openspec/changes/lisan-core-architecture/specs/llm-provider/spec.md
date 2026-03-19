## ADDED Requirements

### Requirement: 统一 LLM 调用接口
系统 SHALL 提供统一的 `LLMProvider` 接口，屏蔽底层 provider 差异，支持 Anthropic 和 OpenAI。

#### Scenario: 调用 Anthropic 模型
- **WHEN** 配置 `provider: anthropic`，调用 `provider.call(options)`
- **THEN** 返回完整文本字符串，token 用量记录在返回值中

#### Scenario: 调用 OpenAI 模型
- **WHEN** 配置 `provider: openai`，调用 `provider.call(options)`
- **THEN** 返回完整文本字符串，接口行为与 Anthropic 一致

### Requirement: 流式输出
系统 SHALL 支持流式文本生成，用于长文本（3000-4000字正文）的实时输出。

#### Scenario: 流式生成正文
- **WHEN** 调用 `provider.stream(options)`
- **THEN** 返回 `AsyncIterable<LLMStreamChunk>`，每个 chunk 包含增量文本

### Requirement: 指数退避重试
系统 SHALL 在 LLM API 调用失败时自动重试，最多 3 次，使用指数退避策略。

#### Scenario: API 限流重试
- **WHEN** LLM API 返回 429 或 5xx 错误
- **THEN** 系统等待后重试，最多重试 3 次，超过后抛出 `LisanError(LLM_RATE_LIMIT)`

### Requirement: 独立超时控制
每个 LLM 调用 SHALL 支持独立超时配置，默认 240 秒。

#### Scenario: 调用超时
- **WHEN** LLM 调用超过配置的 `timeoutMs`
- **THEN** 系统中止请求，抛出 `LisanError(LLM_TIMEOUT)`
