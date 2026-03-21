# 接口目录（标准化）

> 目标：列出当前仓库核心接口，便于按名称定位代码。字段以源码为准，本文件给出职责摘要与文件位置。

## 1. Engine 领域接口

### 1.1 数据模型（`packages/engine/src/types.ts`）

- `Project`：项目元信息（`id/name/basePath/sceneTagTemplate/createdAt`）
- `TagTemplateEntry`：场景标签模板项
- `ProviderType`：`anthropic | openai | newapi`
- `ProviderDefinition`：Provider 配置与凭据字段
- `WorkflowKind`：`scene | chapter`
- `WorkflowDefinition`：工作流主体（含步骤）
- `WorkflowStep`：步骤顺序、Agent 绑定、启停状态、覆盖配置
- `StepConfigOverride`：步骤级参数覆盖（温度、tokens、model、provider、`primaryOutput`）
- `AgentDefinition`：Agent 数据模型（内置/自定义）
- `SceneCard`：场景卡（章节归属、角色、地点、事件骨架、标签）
- `ChapterStatus`：章节状态枚举
- `ChapterDeleteStrategy`：章节删除策略（当前支持 `detach`）
- `Chapter`：章节信息与正文路径
- `ExecutionStatus`：执行状态枚举（`pending/running/completed/failed`）
- `StepStatus`：步骤状态枚举（`pending/running/completed/failed/skipped`）
- `Execution`：一次工作流执行实例
- `ExecutionStep`：执行中的单步骤记录
- `Entity`：结构化实体
- `SettingDocumentSummary` / `SettingDocument`：设定集索引与正文模型
- `SceneGenerationChapterContext` / `DecomposeContext`：场景拆解上下文模型

### 1.2 执行与注册（`packages/engine/src/agent/*.ts`）

- `RegisterOptions`（`agent/registry.ts`）：注册自定义 Agent 参数
- `ExecuteOptions`（`agent/executor.ts`）：执行参数（prompt/context/provider/model/signal）
- `ExecuteResult`（`agent/executor.ts`）：执行结果（text/tokens/duration）

### 1.3 上下文与事件（`packages/engine/src/workflow/*.ts`）

- `ChapterContext`（`workflow/context-builder.ts`）
- `DecomposeContext`（`types.ts`，`context-builder.ts` 复用）
- `WorkflowEvent`（`workflow/events.ts`，含 `step:skipped` 事件）
- `WorkflowEventHandler`（`workflow/events.ts`）

### 1.4 检查器与真相文件（`packages/engine/src/checker|truth/*.ts`）

- `CheckViolation` / `CheckResult`（`checker/post-write-checker.ts`）
- `TruthFiles` / `SettlementData` / `CharacterInteraction` / `HookChange` / `WorldStateChange` / `UpgradeEvent`（`truth/types.ts`）

### 1.5 Engine 入口（`packages/engine/src/engine.ts`）

- `EngineOptions`

### 1.6 Engine RAG 同步接口（`packages/engine/src/rag/sync-service.ts`）

- `RagSyncStage`
- `RagSyncFailure`
- `RagSyncStats`
- `RagSyncStatus`
- `RagSyncEvent`
- `RagSyncStartResult`
- `scanMarkdownFiles`
- `inferDocumentType`

## 2. LLM 接口

文件：`packages/llm/src/types.ts`

- `LLMMessage`
- `LLMCallOptions`（含 `signal`）
- `LLMStreamChunk`
- `LLMCallResult`
- `LLMProvider`
- `ProviderConfig`

## 3. RAG 接口

文件：`packages/rag/src/types.ts`

- `DocumentType`
- `Document`
- `SearchQuery`
- `SearchResult`
- `VectorStore`
- `EmbeddingProvider`

额外配置接口：
- `LanceDBStoreConfig`（`lancedb-store.ts`）
- `DashScopeEmbeddingConfig`（`dashscope-embedding.ts`）
- `DEFAULT_SYNC_DIRS` / `scanMarkdownFiles` / `inferDocumentType` / `collectSyncMarkdownFiles`（`sync-utils.ts`，Engine/CLI 共用）

## 4. Desktop 前端接口

### 4.1 主业务类型（`lisan-desktop/src/types/engine.ts`）

- `TagTemplateEntry`
- `ProviderType`
- `ProviderDefinition`
- `Project`
- `WorkflowDefinition`
- `WorkflowKind`
- `WorkflowStep`
- `StepConfigOverride`
- `AgentDefinition`
- `SceneCard`
- `ChapterStatus`
- `Chapter`
- `ExecutionStatus`
- `StepStatus`
- `Execution`
- `ExecutionStep`
- `ExecutionDetail`
- `SidecarProjectOpenResult`
- `SettingDocumentSummary`
- `SettingDocument`
- `RagSyncStage`
- `RagSyncFailure`
- `RagSyncStats`
- `RagSyncStatus`
- `RagSyncStartResult`
- `WorkflowRunOptions`
- `WorkflowRerunOptions`
- `WorkflowNotification`
- `AppTab`
- `CurrentProject`

### 4.2 API 抽象（`lisan-desktop/src/hooks/useSidecar.ts`）

- `SidecarApi`：前端可调用的完整业务接口集合
  - project: `projectOpen/projectGet/projectUpdate`
  - outline: `outlineGet/outlineSave`
  - workflow: `workflowList/workflowSave/workflowRun/workflowPause/workflowResume/workflowSkip/workflowRerun/workflowAbort`
  - agent: `agentList/agentSave/agentDelete/agentGetMd/agentSaveMd`
  - provider: `providerList/providerSave/providerDelete`
  - scene: `sceneList/sceneSave/sceneDelete/sceneReorder`
  - chapter: `chapterList/chapterSave/chapterCreate/chapterDelete/chapterGetContent/chapterSaveContent`
  - setting: `settingList/settingGet/settingSave/settingDelete`
  - execution: `executionList/executionDetail`
  - rag: `ragSync/ragStatus`

### 4.3 兼容旧页面类型（`lisan-desktop/src/types/lisan.ts`）

- `Project`
- `Execution`
- `ExecutionDetail`
- `PipelineStage`
- `AgentExecution`
- `TokenStats`
- `PassExecution`
- `TraceLogEntry`

状态对齐（兼容层）：
- `Project.status`：`idle/running/completed/failed`
- `Execution.status`：`running/completed/failed`
- `PipelineStage.status`：`pending/running/completed/failed`
- `AgentExecution.status`：`completed/failed`

## 5. Tauri（Rust）接口

### 5.1 状态与项目结构体

- `AppState`（`src-tauri/src/state.rs`）
- `Project`（`src-tauri/src/commands/projects.rs`）
- `LlmProviderConfig`（`src-tauri/src/commands/projects.rs`）
- `LlmConfig`（`src-tauri/src/commands/projects.rs`）
- `CreateProjectInput`（`src-tauri/src/commands/projects.rs`）

`CreateProjectInput.llmConfig`：
- 包含 `orchestrator/worker` 的 `provider/model/temperature`
- 该配置会写入项目 `lisan.config.yaml`，并在 engine 初始化时引导 Provider 默认模型

`Project`（Tauri）返回字段说明：
- `chapterCount/lastExecutionTime/status` 来自 `.lisan/lisan.db` 聚合
- `status` 统一枚举：`idle/running/completed/failed`

### 5.2 Tauri Command（函数接口）

文件：`src-tauri/src/commands/mod.rs` + `projects.rs`

- 项目：`list_projects/create_project/delete_project/project_open/project_get/project_update`
- 纲要：`outline_get/outline_save`
- 工作流：`workflow_list/workflow_save/workflow_run/workflow_pause/workflow_resume/workflow_skip/workflow_rerun/workflow_abort`
- 智能体：`agent_list/agent_save/agent_delete/agent_get_md/agent_save_md`
- Provider：`provider_list/provider_save/provider_delete`
- 场景：`scene_list/scene_save/scene_delete/scene_reorder`
- 章节：`chapter_list/chapter_save/chapter_create/chapter_delete/chapter_get_content/chapter_save_content`
- 设定集：`setting_list/setting_get/setting_save/setting_delete`
- 执行：`execution_list/execution_detail`
- RAG：`rag_sync/rag_status`

## 6. 兼容包接口（简表）

### 6.1 `packages/core/src/index.ts` 导出

- 状态：`ChapterRecord/ProjectState/StateManager/FileStateManager/SqliteEntityGraph`
- Agent：`AgentDefinition/AgentInput/AgentOutput/Agent/AgentExecutor`
- Pipeline：`Pipeline*` 类型、`PassRunner`、`Decompose/Plan/Write/RewritePipeline`
- Context：`SceneDefinition/GeneratedCharacter/ContextPack/ContextAgent`
- Plugin：`BookConfig/LisanPlugin/loadPlugin`
- Observability：`TraceEvent/TraceWriter`
- Checker：`checkDraft`
- Truth：`Truth*` 类型与 `TruthManager`

### 6.2 `packages/cli` 命令接口

- 子命令：`init/decompose/plan/write/rewrite/sync/status`
- 配置接口：`LisanConfig`（`packages/cli/src/config.ts`）

### 6.3 `plugins/webnovel`

- `webnovelPlugin: LisanPlugin`
