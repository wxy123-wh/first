# 代码说明（标准化）

## 1. 模块总览

| 模块 | 路径 | 状态 | 说明 |
|---|---|---|---|
| Engine | `packages/engine` | 主路径 | 工作流、执行、存储、sidecar |
| LLM | `packages/llm` | 主路径 | Provider 抽象与实现 |
| RAG | `packages/rag` | 主路径 | 向量库与 embedding |
| Desktop | `lisan-desktop` | 主路径 | Tauri + React 桌面端 |
| Core | `packages/core` | 兼容保留 | v1 核心（deprecated） |
| CLI | `packages/cli` | 兼容保留 | v1 命令行（deprecated） |
| Plugin | `plugins/webnovel` | 兼容保留 | v1 网文插件（deprecated） |

## 2. Engine（`packages/engine`）

### 2.1 store 子模块

- `store/database.ts`
  - 初始化 `.lisan/lisan.db`
  - 维护表结构：`projects/providers/workflows/workflow_steps/agents/chapters/scenes/executions/execution_steps/entities`
  - 启用 WAL 与外键
  - 负责列级迁移（`providers.model/apiKeyCiphertext`，`workflows.kind`）

- `store/credential-vault.ts`
  - API Key 加密算法：`aes-256-gcm`
  - 密钥文件：`.lisan/provider-api-key.key`
  - 支持 `encrypt/decrypt` 与旧数据平滑迁移

- `store/store-manager.ts`
  - 统一仓储服务，覆盖项目/Provider/Workflow/Agent/Scene/Chapter/Execution/Entity
  - 自动补齐默认 Provider
  - 自动迁移旧大纲路径（`outline.md` -> `大纲/arc-1.md`）
  - 自动推断并回填 `workflow.kind`
  - 在空 Agent 基线下可从 `lisan.config.yaml`（`llm.orchestrator/worker`）引导 Provider 默认模型

### 2.2 agent 子模块

- `agent/registry.ts`
  - 内置 Agent 启动引导（seed）
  - 自定义 Agent 注册、更新、复制、删除
  - 内置 Agent Markdown 文件保护

- `agent/executor.ts`
  - 负责模板渲染后调用 LLM Provider
  - 支持 provider 实例缓存
  - 支持环境变量回退（`OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `NEWAPI_API_KEY`）
  - 支持透传 `AbortSignal` 到 Provider 调用

### 2.3 workflow 子模块

- `workflow/context-builder.ts`
  - 构建章节上下文（场景、实体、上一章尾部）
  - 构建拆解上下文（大纲、已有场景、标签模板）
  - 章节上下文仅纳入当前章节绑定场景（`scene.chapterId === chapterId`）

- `workflow/defaults.ts`
  - 自动识别场景流/章节流
  - 缺省时自动创建“默认场景工作流”与“默认章节工作流”
  - 默认章节流将“终审 Agent”标记为 `primaryOutput`

- `workflow/runtime.ts`
  - 工作流主执行器（run/pause/resume/skip/abort/rerun）
  - 运行控制包含 `currentStepId` 与 `AbortController`（支持运行中中断）
  - 每步写 execution_step 记录
  - 渲染模板后检查未解析占位符
  - step 未显式覆盖 `model` 时，按 Provider 默认模型解析执行
  - 从 step 输出解析场景 JSON 并去重落库
  - 场景缺失 `chapterId` 时可按入口章节兜底绑定，并在完成摘要提示
  - 章节流完成后自动回写正文（`primaryOutput` 优先，回退最后有效文本输出）
  - 正文回写失败会将 execution 置为 `failed`，避免“假成功”
  - 事件推送：`workflow:*`、`step:*`

- `workflow/events.ts`
  - 定义事件结构与 handler 签名

### 2.4 sidecar 子模块

- `sidecar/main.ts`
  - JSON-RPC over stdio 服务入口
  - 注册 `project/workflow/agent/provider/scene/chapter/execution/entity` 方法
  - 转发 runtime 事件为 JSON-RPC 通知
  - `workflow.run` 异常以 `workflow:error` 通知上报

- `sidecar/rpc-server.ts`
  - JSON-RPC 2.0 基础处理：解析、方法分发、通知、错误码

### 2.5 其他子模块

- `truth/truth-manager.ts`：真相文件读写、结算应用、滞留伏笔标记
- `checker/post-write-checker.ts`：11 条确定性规则检查
- `template/engine.ts`：模板渲染
- `engine.ts`：Engine 组装入口（Store + AgentRegistry + AgentExecutor + WorkflowRuntime）

## 3. LLM（`packages/llm`）

- 统一接口：`LLMProvider`（`call` + `stream`）
- 实现：`AnthropicProvider`、`OpenAIProvider`、`NewApiProvider`
- 工厂：`createProvider(config)`
- 重试：`withRetry`（限流与 5xx 场景指数退避）

## 4. RAG（`packages/rag`）

- `LanceDBStore`：向量检索 + FTS 检索 + upsert/delete/getById
- `DashScopeEmbeddingProvider`：支持分批嵌入与排序回填
- `layers.ts`：L0 摘要 / L1 概览 / L2 全文三层读取

## 5. Desktop（`lisan-desktop`）

### 5.1 页面模块

- `ProjectsPage`：项目列表（读 `.lisan/lisan.db` 聚合：章节数/最近执行时间/最新执行状态）+ 删除
- `NewProjectPage`：创建项目（创建时将 `llmConfig` 写入项目配置并引导 Provider 默认模型）
- `OutlinePage`：编辑大纲 + 触发场景拆解
- `ScenesPage`：场景树编辑 + AI 生成 + 排序 + 未绑定章节筛选/修复
- `ChaptersPage`：章节创建、正文编辑、workflow 切换即时持久化、运行工作流（完成后自动刷新正文）
- `WorkflowsPage`：工作流编辑、步骤拖拽排序
- `AgentsPage` / `AgentEditPage`：智能体维护、复制内置、Provider 切换
- `ProvidersPage`：Provider 参数维护（model/baseUrl/apiKey）
- `ExecutionsPage` / `ExecutionDetailPage`：执行历史、实时控制（pause/resume/skip/abort）与状态反馈
- `SettingsPage` / `RagSyncPage`：项目标签模板与 RAG 状态页（当前为禁用态）

### 5.2 前端关键抽象

- `hooks/useSidecar.ts`：统一 command 调用接口
- `hooks/useWorkflowEvents.ts`：订阅 sidecar 通知并入全局状态
- `lib/store.ts`：`currentProject/activeTab/sidecar/workflowEvents` 状态中心
- `types/engine.ts`：前后端共享语义类型

## 6. Tauri（`lisan-desktop/src-tauri`）

- `commands/mod.rs`：Tauri command 到 sidecar RPC 的映射层，含 fallback 策略
- `commands/projects.rs`：本地项目扫描/创建/删除（无需 sidecar）；首页统计由 DB 聚合并统一状态枚举
- `sidecar.rs`：sidecar 进程生命周期、请求超时、掉线重启、构建一致性校验
- `state.rs`：全局状态（workspace_root + sidecar manager）

## 7. 兼容保留模块

- `packages/core`：v1 核心实现，保留用于旧 CLI/插件链路
- `packages/cli`：v1 命令行，仍可单独构建
- `plugins/webnovel`：v1 写作风格配置插件

> 说明：上述兼容模块并非当前 desktop 主路径，但代码仍存在并可被旧流程引用。
