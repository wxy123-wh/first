# Lisan — 技术架构规划

> WebNovel Writer 的独立软件化版本。
> 将 AI 驱动的网文写作管线从 OpenClaw 中解耦，构建为标准化 CLI 工具。

---

## Monorepo 结构

```
lisan/
├── packages/
│   ├── llm/           # @lisan/llm — LLM 调用封装（多 provider 统一接口）
│   │   └── src/
│   │       ├── types.ts              # LLMProvider/LLMCallOptions/LLMStreamChunk 接口
│   │       ├── anthropic-provider.ts # Anthropic 实现（Vercel AI SDK）
│   │       ├── openai-provider.ts    # OpenAI 实现（Vercel AI SDK）
│   │       ├── factory.ts            # createProvider() 工厂函数
│   │       ├── retry.ts              # p-retry 指数退避重试
│   │       └── index.ts
│   ├── rag/           # @lisan/rag — 向量数据库封装（LanceDB + embedding）
│   │   └── src/
│   │       ├── types.ts              # Document/SearchQuery/VectorStore 接口
│   │       ├── lancedb-store.ts      # LanceDB 完整实现
│   │       ├── dashscope-embedding.ts # DashScope text-embedding-v3 实现
│   │       ├── layers.ts             # L0/L1/L2 三层渐进式读取
│   │       └── index.ts
│   ├── core/          # @lisan/core — 核心引擎
│   │   └── src/
│   │       ├── errors/               # LisanError + LisanErrorCode
│   │       ├── state/                # FileStateManager + SqliteEntityGraph
│   │       ├── agent/                # AgentExecutor（prompt 模板注入 + token 统计）
│   │       ├── pipeline/
│   │       │   ├── types.ts              # Pipeline/Pass/PassDefinition 接口
│   │       │   ├── pass-runner.ts        # PassRunner（串行执行 + 单 Pass 重跑）
│   │       │   ├── preflight.ts          # Preflight 校验（scenes.md/chapter-plan.md/.lisan）
│   │       │   ├── model-router.ts       # ModelRouter（编排器/执行器模型路由）
│   │       │   ├── decompose-pipeline.ts # DecomposePipeline（大纲→场景树分解）
│   │       │   ├── plan-pipeline.ts      # PlanPipeline（场景树→章节规划生成）
│   │       │   ├── write-pipeline.ts     # WritePipeline 完整实现（6 步管线）
│   │       │   └── rewrite-pipeline.ts   # RewritePipeline（已有章节改写管线）
│   │       ├── context/
│   │       │   ├── types.ts          # SceneDefinition/ContextPack/GeneratedCharacter
│   │       │   └── context-agent.ts  # ContextAgent（章节规划解析+场景组装+自主创角+RAG检索）
│   │       ├── plugin/
│   │       │   ├── types.ts          # BookConfig/LisanPlugin 接口
│   │       │   └── loader.ts         # loadPlugin() 动态插件加载器
│   │       ├── observability/        # TraceWriter（JSONL 追踪日志）
│   │       └── index.ts
│   └── cli/           # @lisan/cli — CLI 入口
│       └── src/
│           ├── config.ts             # cosmiconfig + zod 配置加载验证
│           ├── commands/
│           │   ├── shared.ts         # 共享工具（createEmbeddingProvider/createVectorStore）
│           │   ├── init.ts           # lisan init
│           │   ├── decompose.ts      # lisan decompose（对接 DecomposePipeline + ora + confirm）
│           │   ├── plan.ts           # lisan plan（对接 PlanPipeline + ora + confirm）
│           │   ├── write.ts          # lisan write（对接 WritePipeline + ora + confirm）
│           │   ├── rewrite.ts        # lisan rewrite（对接 RewritePipeline + ora + confirm）
│           │   ├── sync.ts           # lisan sync（embedding 同步 + git commit + ora + confirm）
│           │   └── status.ts         # lisan status
│           └── index.ts              # Commander.js 入口
├── plugins/
│   └── webnovel/      # @lisan/plugin-webnovel — 网文写作插件
│       └── src/
│           └── index.ts              # 血色天平风格 BookConfig
├── pnpm-workspace.yaml
├── package.json
└── tsconfig.base.json
```

## 技术栈

| 层 | 选型 |
|----|------|
| 语言 | TypeScript 5.x (ESM + strict) |
| 运行时 | Node.js 22+ (Volta pinned 24.14.0) |
| 包管理 | pnpm workspace |
| 构建 | tsup (ESM + CJS) |
| 测试 | vitest ^4.1.0 |
| LLM SDK | Vercel AI SDK (`ai` + `@ai-sdk/anthropic` + `@ai-sdk/openai`) |
| 向量库 | LanceDB (嵌入式) |
| 实体图谱 | SQLite (`better-sqlite3`) |
| CLI | Commander.js v12 |
| 配置 | cosmiconfig + zod |

## 包依赖关系

```
@lisan/cli → @lisan/core → @lisan/llm
                          → @lisan/rag
@lisan/plugin-webnovel → @lisan/core
```

## 当前状态

全部功能完成。5 个包构建零错误，7 个测试文件 58 个单元/集成测试全部通过。

### 已完成
- Monorepo 骨架（pnpm workspace + tsup 构建 + vitest 测试框架）
- `@lisan/llm`：LLMProvider 接口 + Anthropic/OpenAI 实现 + 工厂函数 + p-retry 指数退避重试 + AbortSignal 超时 + 单元测试（5 tests）
- `@lisan/rag`：VectorStore 接口 + LanceDB 完整实现（init/upsert/search/delete/getById/close）+ 向量检索 + FTS 全文搜索 + metadata.type 过滤 + L0/L1/L2 读取 + DashScope text-embedding-v3 实现（分批处理 + 排序保证）+ 单元测试（16 tests）
- `@lisan/core`：
  - 错误体系（LisanError + 12 个错误码）
  - FileStateManager 完整实现 + schema 版本检测与链式迁移框架（registerMigration）+ 单元测试（5 tests）
  - SqliteEntityGraph 完整实现（better-sqlite3, WAL 模式, 索引优化, CRUD + findNeedsReview）+ 单元测试（9 tests）
  - AgentExecutor（prompt {{key}} 模板注入 + token 统计 + 耗时记录）+ 单元测试（6 tests）
  - PassRunner（串行执行 + 单 Pass 重跑）
  - Preflight 校验（scenes.md / chapter-plan.md / .lisan 目录检查）+ 单元测试（3 tests）
  - ModelRouter（编排器/执行器模型路由，按 AgentDefinition.model 匹配）+ 单元测试（1 test）
  - ContextAgent 完整实现（chapter-plan.md 解析 + scenes.md 解析 + 上章尾部读取 + RAG 设定检索 + 实体图谱角色卡 + 自主创角 + 持久化分级 + permanent needsReview 标记）
  - WritePipeline 完整 6 步管线（Context Agent → Draft Agent → 5 Pass 改写链 → Review Agent → Data Agent → Git commit）+ 插件 Pass 覆盖机制 + 集成测试（3 tests）
  - DecomposePipeline（读取大纲 → RAG 设定检索 → LLM 场景分解 → 写入 scenes.md）+ 单元测试（3 tests）
  - PlanPipeline（读取场景树 → RAG 设定检索 → LLM 章节规划 → 写入 chapter-plan.md）+ 单元测试（3 tests）
  - RewritePipeline（Context Agent → 读取已有正文 → Pass 改写链 → Review Agent → 写回文件 + Git commit）+ 单元测试（4 tests）
  - 插件加载器 loadPlugin()（内置插件表 + npm 包动态 import + 本地路径支持）
  - TraceWriter JSONL 追踪日志
- `@lisan/cli`：
  - Commander.js 入口 + 全部 7 个子命令（init/decompose/plan/write/rewrite/sync/status）
  - cosmiconfig 配置加载 + zod schema 验证 + 环境变量 ${VAR} 替换
  - 共享工具模块 shared.ts（createEmbeddingProvider/createVectorStore）
  - decompose 命令完整对接 DecomposePipeline（--yes 跳过确认 + ora 进度条）
  - plan 命令完整对接 PlanPipeline（--yes + ora）
  - write 命令完整对接 WritePipeline（--batch/--dry-run/--no-git/--rerun-pass/--yes + ora）
  - rewrite 命令完整对接 RewritePipeline（--no-git/--rerun-pass/--yes + ora）
  - sync 命令完整实现（递归扫描 Markdown → 分批 embedding upsert → git commit + --no-git/--yes + ora）
  - 所有命令集成 @inquirer/prompts 交互式确认 + ora 进度条
- `@lisan/plugin-webnovel`：血色天平风格 BookConfig（4 爽点类型 + 9 Agent + 5 Pass + createPass 覆盖接口）

### 待实现（v7.1）
- 确定性后验证器（Post-Write Checker）：零 LLM 成本的 11 条规则检查，注入 Pass prompt
- 真相文件体系（Truth Files）：`truth/` 目录下的世界状态快照、伏笔追踪表、角色交互矩阵
- 写前自检 / 写后结算（PRE_WRITE_CHECK / POST_SETTLEMENT）：Draft Agent 三阶段输出 + 真相文件自动更新

详见 `openspec/changes/v7.1-upgrade/spec.md`
