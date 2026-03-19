## ADDED Requirements

### Requirement: Agent 定义与执行
系统 SHALL 支持通过 `AgentDefinition` 定义 Agent，并通过 `Agent.run()` 执行。

#### Scenario: 执行单个 Agent
- **WHEN** 调用 `agent.run({ userPrompt, context })`
- **THEN** 返回 `AgentOutput`，包含生成文本、token 用量、耗时

### Requirement: Prompt 模板注入
系统 SHALL 支持将 `context` 键值对注入 system prompt 模板，替换 `{{key}}` 占位符。

#### Scenario: 模板变量替换
- **WHEN** `systemPrompt` 包含 `{{chapterNumber}}`，`context` 传入 `{ chapterNumber: "5" }`
- **THEN** 实际发送给 LLM 的 prompt 中 `{{chapterNumber}}` 被替换为 `"5"`

### Requirement: Token 用量统计
系统 SHALL 记录每次 Agent 调用的 inputTokens、outputTokens 和耗时。

#### Scenario: 用量记录
- **WHEN** Agent 调用完成
- **THEN** `AgentOutput.usage` 包含 `inputTokens`、`outputTokens`，`durationMs` 记录实际耗时

### Requirement: 每 Agent 独立超时
系统 SHALL 允许每个 AgentDefinition 配置独立的 `timeoutMs`，覆盖全局默认值（240s）。

#### Scenario: Agent 级超时覆盖
- **WHEN** `AgentDefinition.timeoutMs = 300000`
- **THEN** 该 Agent 的 LLM 调用使用 300s 超时，不受全局配置影响
