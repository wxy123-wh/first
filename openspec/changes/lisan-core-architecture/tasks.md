## 1. Monorepo 骨架

- [x] 1.1 初始化 pnpm workspace，创建 `pnpm-workspace.yaml` 和根 `package.json`
- [x] 1.2 创建 `tsconfig.base.json`，配置 ESM + strict 模式
- [x] 1.3 创建四个包目录：`packages/llm`、`packages/rag`、`packages/core`、`packages/cli`
- [x] 1.4 每个包配置 `package.json`（name/version/exports）和 `tsconfig.json`
- [x] 1.5 配置 tsup 构建，输出 ESM + CJS

## 2. packages/llm — LLM Provider

- [x] 2.1 定义 `LLMProvider`、`LLMCallOptions`、`LLMStreamChunk` 接口（`src/types.ts`）
- [x] 2.2 实现 `AnthropicProvider`（基于 Vercel AI SDK `streamText`）
- [x] 2.3 实现 `OpenAIProvider`（基于 Vercel AI SDK）
- [x] 2.4 实现 `createProvider(config)` 工厂函数
- [x] 2.5 集成 `p-retry` 指数退避重试（最多3次）
- [x] 2.6 集成 `AbortSignal.timeout()` 超时控制
- [x] 2.7 单元测试：mock provider，验证重试和超时行为

## 3. packages/rag — 向量数据库

- [x] 3.1 定义 `Document`、`SearchQuery`、`SearchResult`、`VectorStore` 接口（`src/types.ts`）
- [x] 3.2 实现 `LanceDBStore`，封装 `@lancedb/lancedb`
- [x] 3.3 实现 `upsert`：写入文档 + 自动生成 embedding（DashScope text-embedding-v3）
- [x] 3.4 实现 `search`：向量检索 + BM25 混合模式
- [x] 3.5 实现按 `metadata.type` 过滤
- [x] 3.6 实现 L0/L1/L2 三层读取辅助函数
- [x] 3.7 单元测试：upsert + search 基本流程

## 4. packages/core — 错误与状态

- [x] 4.1 实现 `LisanError` + `LisanErrorCode` 枚举（`src/errors.ts`）
- [x] 4.2 定义 `ProjectState`、`ChapterRecord`、`StateManager` 接口（`src/state/types.ts`）
- [x] 4.3 实现 `FileStateManager`：读写 `state.json`，`updateChapter` 原子更新
- [x] 4.4 实现 SQLite 实体图谱（`better-sqlite3`）：角色/地点/物品/事件 CRUD
- [x] 4.5 实现 schema 版本检测与迁移框架
- [x] 4.6 单元测试：state 读写、实体图谱 CRUD

## 5. packages/core — Agent 执行器

- [x] 5.1 定义 `AgentDefinition`、`AgentInput`、`AgentOutput`、`Agent` 接口（`src/agent/types.ts`）
- [x] 5.2 实现 `AgentExecutor`：prompt 模板注入（`{{key}}` 替换）
- [x] 5.3 实现 token 用量统计和耗时记录
- [x] 5.4 实现可观测性日志写入（`TraceEvent` → `.lisan/observability/trace.jsonl`）
- [x] 5.5 单元测试：模板注入、用量统计

## 6. packages/core — 管线引擎

- [x] 6.1 定义 `Pass`、`PassInput`、`PassOutput`、`Pipeline`、`PipelineContext` 接口
- [x] 6.2 实现 `PassRunner`：串行执行 Pass 链，传递 `revised` 文本
- [x] 6.3 实现单 Pass 重跑（`--rerun-pass N`）
- [x] 6.4 实现 Preflight 校验（检查 scenes.md / chapter-plan.md 存在性）
- [x] 6.5 实现编排器/执行器模型路由（按 Agent 角色选择 provider）
- [x] 6.6 集成测试：mock LLM，验证 Pass 链传递正确

## 7. packages/core — Context Agent

- [x] 7.1 定义 `SceneDefinition`（含 `allowNewCharacters`、`newCharacterHints`）和 `ContextPack` 接口
- [x] 7.2 定义 `GeneratedCharacter` 接口（含 `persistence` 三级策略）
- [x] 7.3 实现 Context Agent：读取 chapter-plan.md + scenes.md，组装执行包
- [x] 7.4 实现自主创角判断逻辑：按场景情绪任务和 `allowNewCharacters` 决定是否创角
- [x] 7.5 实现创角持久化：`chapter` 只写临时文件，`arc`/`permanent` 写入实体图谱
- [x] 7.6 实现 `permanent` 角色 `needsReview` 标记
- [x] 7.7 实现 L0→L1→L2 渐进式设定检索（集成 RAG）
- [x] 7.8 集成测试：验证执行包生成和自主创角流程

## 8. packages/core — write 管线完整实现

- [x] 8.1 实现 5 个 Pass Agent 定义（体验植入/爽点强化/节奏张力/对话博弈/Anti-AI）
- [x] 8.2 实现起草 Agent
- [x] 8.3 实现终审 Agent（场景完成度 + 体验审查 + 直接修复）
- [x] 8.4 实现 Progression：检测角色升级事件，更新实体图谱
- [x] 8.5 实现 Data Agent：实体提取 + 章节摘要 + 向量嵌入
- [x] 8.6 实现 Step 6 同步：git commit（`simple-git`）
- [x] 8.7 端到端测试：完整 write 管线（mock LLM）

## 9. packages/cli — CLI 入口

- [x] 9.1 搭建 Commander.js 入口，注册 `init`/`decompose`/`plan`/`write`/`rewrite`/`status`/`sync` 命令
- [x] 9.2 实现 `lisan init`：创建标准项目目录结构和 `lisan.config.yaml`
- [x] 9.3 实现 `lisan write <chapter>`：调用 write 管线，chalk + ora 进度展示
- [x] 9.4 实现 `lisan write --batch <range>`：串行批量执行
- [x] 9.5 实现 `--dry-run`：生成执行包，不调用 LLM
- [x] 9.6 实现 `lisan status`：章节进度 + 待审查角色 + token/成本统计
- [x] 9.7 实现 cosmiconfig 配置文件加载（`lisan.config.yaml`），zod schema 验证

## 10. 插件系统

- [x] 10.1 定义 `LisanPlugin`、`BookConfig` 接口（`packages/core/src/plugin/types.ts`）
- [x] 10.2 实现插件加载器：按 `book.plugin` 配置动态加载
- [x] 10.3 实现 `plugins/webnovel`：血色天平风格 BookConfig（爽点类型/摄像机规则/Anti-AI词汇表）
- [x] 10.4 实现插件 Pass 覆盖机制：`createPass()` 返回非 null 时替换默认实现
