## Why

AI 直接从大纲生成正文质量极差——流水账、角色崩坏、情绪平线。根本原因是颗粒度断层（大纲直跳正文）、无体验设计（只写对事件不让读者感受）、单次生成天花板（单 prompt 无法同时处理所有维度）。Lisan 通过三层架构 + 多 Pass 重写管线解决这三个问题，并作为独立 CLI 工具从 OpenClaw 中解耦。

## What Changes

- 新建 monorepo 项目 `lisan`，包含 `packages/llm`、`packages/rag`、`packages/core`、`packages/cli`
- 引入四条管线：`decompose`（场景分解）、`plan`（章节规划）、`write`（正文写作）、`rewrite`（纯重写）
- 实现 5 Pass 串行重写管线（体验植入 → 爽点强化 → 节奏张力 → 对话博弈 → Anti-AI）
- 实现 Context Agent，支持自主创角（配角/路人按场景需要生成，不受大纲约束）
- 实现三层渐进式上下文读取（L0/L1/L2），控制长篇小说的 token 消耗
- 实现编排器/执行器分离（强模型调度，性价比模型执行）
- 集成 LanceDB + BM25 混合检索 RAG
- 插件系统支持不同书的风格配置热插拔

## Capabilities

### New Capabilities

- `llm-provider`: 统一 LLM 调用接口，支持多 provider（Anthropic/OpenAI/本地模型），流式输出，指数退避重试
- `rag-store`: 向量数据库封装（LanceDB + BM25 混合检索），三层渐进式读取（L0/L1/L2），embedding 管理
- `agent-executor`: Agent 定义与执行，支持 system prompt 模板、token 统计、超时控制
- `pipeline-engine`: 四条管线调度引擎，Pass 串行执行，编排器/执行器分离
- `context-agent`: 场景驱动的上下文组装，自主创角判断（chapter/arc/permanent 持久化策略），执行包生成
- `state-manager`: 项目状态持久化（state.json），章节记录，实体图谱（SQLite）
- `cli-commands`: Commander.js CLI 入口，四条管线命令，`--dry-run`/`--batch`/`--no-git` 选项
- `plugin-system`: 风格插件接口（BookConfig），Pass 实现可覆盖，`plugins/webnovel` 参考实现

### Modified Capabilities

（无，这是全新项目）

## Impact

- 新增依赖：`ai`（Vercel AI SDK）、`@lancedb/lancedb`、`better-sqlite3`、`commander`、`@inquirer/prompts`、`chalk`、`ora`、`cosmiconfig`、`zod`、`p-retry`、`simple-git`
- 运行时：Node.js 22 LTS，TypeScript 5.x，pnpm workspace
- 外部服务依赖：LLM API（Anthropic/OpenAI）、DashScope embedding API
- 无破坏性变更（新项目）
