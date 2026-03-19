## ADDED Requirements

### Requirement: 插件接口定义
系统 SHALL 定义 `LisanPlugin` 接口，允许插件提供 `BookConfig` 并可选覆盖 Pass 实现。

#### Scenario: 加载插件
- **WHEN** `lisan.config.yaml` 配置 `book.plugin: "webnovel"`
- **THEN** 系统加载 `plugins/webnovel`，使用其 `BookConfig`（爽点类型、摄像机规则、Anti-AI 词汇表等）

#### Scenario: 插件覆盖 Pass 实现
- **WHEN** 插件的 `createPass("pass-2-thrill-boost")` 返回非 null
- **THEN** 管线使用插件提供的 Pass 实现，替代默认实现

#### Scenario: 插件不覆盖时使用默认
- **WHEN** 插件的 `createPass("pass-1-experience")` 返回 null
- **THEN** 管线使用默认 Pass 实现

### Requirement: BookConfig 可配置项
系统 SHALL 通过 `BookConfig` 支持以下可配置项：爽点类型、主角 ID、摄像机规则、感官优先级、Anti-AI 词汇表、Pass 定义列表、Agent 定义列表、章节字数范围。

#### Scenario: 自定义爽点类型
- **WHEN** `BookConfig.thrillTypes = ["恋爱心动", "悬疑反转", "热血燃烧"]`
- **THEN** 场景分解器和 Pass 2 使用自定义爽点类型，不使用默认的网文爽点类型

### Requirement: webnovel 参考插件
系统 SHALL 提供 `plugins/webnovel` 作为参考实现，包含血色天平风格的完整配置。

#### Scenario: webnovel 插件加载
- **WHEN** 配置 `plugin: "webnovel"`
- **THEN** 加载怒火宣泄/悲剧/智商碾压/战斗快感四种爽点类型，锁定主角体内摄像机规则，触觉优先感官配置
