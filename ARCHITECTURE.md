# Lisan 架构说明（当前实现）

## 1. 目标与范围

Lisan 当前是一个桌面优先的 AI 写作系统：
- 前端：React + Tauri
- 本地桥接：Rust（Tauri command）
- 执行核心：Node sidecar（`@lisan/engine`）
- 基础能力：LLM / RAG / 本地 SQLite 与文件系统

本文件只描述“已实现代码”，不再记录历史计划。

## 2. 分层架构

### 2.1 UI 层（`lisan-desktop/src`）

- 路由页面：项目、纲要、场景、章节、工作流、智能体、Provider、执行详情、设置
- 状态中心：`zustand`（当前项目、sidecar 状态、实时工作流事件）
- 统一 API：`useSidecar()`，通过 Tauri `invoke` 调用 Rust command

### 2.2 桥接层（`lisan-desktop/src-tauri/src`）

- `commands/mod.rs`：定义全部 Tauri command
- `sidecar.rs`：sidecar 生命周期管理、JSON-RPC 请求、超时、重启、事件转发
- `commands/projects.rs`：本地项目扫描/初始化/删除（不经 sidecar）

### 2.3 运行时层（`packages/engine/src`）

- `store/`：SQLite 数据模型 + 凭据加密 + 文件路径迁移
- `agent/`：内置/自定义 Agent 注册、管理与执行
- `workflow/`：上下文构建、默认工作流推断、运行时执行控制
- `sidecar/main.ts`：JSON-RPC 服务入口
- `truth/`：真相文件模板、读写、结算更新
- `checker/`：确定性后验证器（11 条规则）

### 2.4 能力层（`packages/llm`, `packages/rag`）

- `@lisan/llm`：Anthropic/OpenAI/NewAPI Provider 抽象
- `@lisan/rag`：LanceDB 向量存储 + DashScope Embedding + 分层读取（L0/L1/L2）

### 2.5 兼容层（保留）

- `@lisan/core`：旧核心包（`deprecated`）
- `@lisan/cli`：旧 CLI 包（`deprecated`）
- `@lisan/plugin-webnovel`：旧插件包（`deprecated`）

## 3. 数据与调用流

### 3.1 UI 调用链

1. 页面调用 `useSidecar()` 方法
2. `invoke("xxx_command")` 进入 Rust command
3. Rust command 转换参数并调用 sidecar JSON-RPC
4. sidecar 调用 Engine（Store/Workflow/Agent）
5. 结果回传 UI，事件通过 `sidecar:notification` 推送

### 3.2 工作流执行链

1. 创建 execution 记录（`executions` + `execution_steps`）
2. 逐步骤渲染模板并执行 Agent
3. 写入 step 输出、tokens、duration
4. 触发事件：`step:start/complete/failed`、`workflow:complete`
5. 若输出为场景 JSON，自动去重落库到 `scenes`

## 4. 已实现能力清单

- 项目管理：创建、枚举、删除 `.lisan` 工作目录
- 纲要管理：读取/保存 `大纲/arc-1.md`
- 场景管理：树结构展示、增删改、排序、AI 拆解
- 章节管理：创建章节、编辑正文、绑定工作流并运行
- 工作流管理：场景/章节工作流编辑、步骤拖拽排序、配置覆盖
- 智能体管理：内置 Agent 引导、自定义 Agent、复制内置并替换引用
- Provider 管理：模型/URL/API Key 配置，数据库密钥加密存储
- 执行监控：列表/详情、实时事件、暂停/恢复/跳过/终止
- Sidecar 稳定性：掉线重启、请求超时、方法回退、构建一致性校验
- 真相文件体系：模板初始化、结算写入、滞留伏笔标记
- 确定性检查器：11 条文风规则，输出错误/警告摘要

## 5. 关键实现注意点

- Provider API Key 不再明文落库：`providers.apiKeyCiphertext` + 本地 AES-GCM 密钥文件
- `outline.md` 会迁移到 `大纲/arc-1.md`
- `workflow.kind` 缺失时自动推断并回填数据库
- Rust command 对旧/新 RPC 名称有 fallback（例如 `workflow.run` / `workflow.rerun`）
- sidecar 启动前会校验 `packages/engine/src` 是否晚于 `dist/sidecar`，防止“代码更新但 sidecar 未重建”
