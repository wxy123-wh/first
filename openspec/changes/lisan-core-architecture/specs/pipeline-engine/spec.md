## ADDED Requirements

### Requirement: 四条管线调度
系统 SHALL 实现 `decompose`、`plan`、`write`、`rewrite` 四条管线，每条管线通过 `Pipeline.run(ctx)` 执行。

#### Scenario: 执行 write 管线
- **WHEN** 调用 `pipeline.run({ projectRoot, bookConfig, chapterNumber: 5 })`
- **THEN** 依次执行 Preflight → Context Agent → 起草 → 5 Pass → 终审 → Data Agent → 同步，返回 `PipelineResult`

### Requirement: Pass 串行执行
系统 SHALL 按 `PassDefinition.order` 串行执行所有 Pass，每个 Pass 的输入是上一个 Pass 的输出。

#### Scenario: Pass 链式传递
- **WHEN** Pass 1 完成，输出 `revised` 文本
- **THEN** Pass 2 的 `PassInput.draft` 为 Pass 1 的 `revised`，以此类推

### Requirement: 单 Pass 重跑
系统 SHALL 支持对指定 Pass 单独重跑，不影响其他 Pass 的结果。

#### Scenario: 重跑 Pass 3
- **WHEN** 用户指定 `--rerun-pass 3`
- **THEN** 系统读取 Pass 2 的输出作为输入，只执行 Pass 3，覆盖原 Pass 3 输出

### Requirement: 编排器/执行器模型分离
系统 SHALL 支持为编排器和执行器配置不同的 LLM 模型。

#### Scenario: 编排器用强模型
- **WHEN** 配置 `llm.orchestrator.model: claude-opus-4-6`，`llm.worker.model: gpt-4o`
- **THEN** 终审、调度类 Agent 使用 claude-opus-4-6，起草和重写 Pass 使用 gpt-4o

### Requirement: Preflight 校验
系统 SHALL 在管线执行前校验项目结构完整性。

#### Scenario: 缺少 chapter-plan.md
- **WHEN** 目标章节的 `chapter-plan.md` 不存在
- **THEN** 管线中止，抛出 `LisanError(CHAPTER_PLAN_MISSING)`
