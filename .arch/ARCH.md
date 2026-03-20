# Lisan — Architecture

## Tech Stack

TypeScript + pnpm monorepo + Vercel AI SDK + LanceDB + SQLite + Tauri + React

## Module Map

- **CLI入口** — 用户操作入口，提供init/decompose/plan/write/rewrite/sync/status等命令，加载配置并调度核心管线。
  - index.ts ()
  - config.ts ()
  - init.ts ()
  - decompose.ts ()
  - plan.ts ()
  - write.ts ()
  - rewrite.ts ()
  - sync.ts ()
  - status.ts ()
  - shared.ts ()
- **桌面前端** — Tauri桌面应用的React前端，提供项目管理、执行监控和工作区界面。
  - App.tsx ()
  - main.tsx ()
  - ProjectsPage.tsx ()
  - ProjectPage.tsx ()
  - NewProjectPage.tsx ()
  - WorkspacePage.tsx ()
  - ExecutionDetailPage.tsx ()
  - cli.ts ()
  - index.ts ()
  - store.ts ()
  - utils.ts ()
  - jsonl-parser.ts ()
  - lisan.ts ()
- **Tauri后端** ⚠️ — Tauri Rust后端，提供CLI调用、文件操作、项目管理和执行记录等命令。
  - main.rs ()
  - lib.rs ()
  - state.rs ()
  - mod.rs ()
  - cli.rs ()
  - config.rs ()
  - executions.rs ()
  - files.rs ()
  - projects.rs ()
- **管线引擎** ⚠️ — 核心编排系统，包含4条管线（Decompose/Plan/Write/Rewrite），通过PassRunner逐步执行，ModelRouter选择模型。
  - types.ts ()
  - pass-runner.ts ()
  - model-router.ts ()
  - decompose-pipeline.ts ()
  - plan-pipeline.ts ()
  - write-pipeline.ts ()
  - rewrite-pipeline.ts ()
  - preflight.ts ()
  - draft-parser.ts ()
  - index.ts ()
- **Agent执行器** ⚠️ — 封装LLM调用逻辑，根据Agent定义（系统提示词、模型、温度）执行推理任务并返回结果。
  - types.ts ()
  - executor.ts ()
  - index.ts ()
  - agent.test.ts ()
- **上下文组装** ⚠️ — ContextAgent根据当前场景从RAG和状态中检索相关信息，组装为LLM可用的上下文。
- **插件系统** ⚠️ — 定义插件接口（LisanPlugin），加载BookConfig和自定义Pass，支持按类型扩展写作风格。
- **真相管理器** ⚠️ — 管理小说的设定真相（settlement data）、角色交互记录和世界状态，确保写作一致性。
  - types.ts ()
  - truth-manager.ts ()
  - index.ts ()
  - truth-manager.test.ts ()
- **质量检查** — 对生成的草稿进行确定性后验证，检查格式、字数、禁用词等规则。
- **网文插件** — 网文写作插件，定义血色天平风格的BookConfig，包含5遍改写Pass和8个Agent定义。
- **LLM抽象层** ⚠️ — 统一的LLM提供者抽象，封装Anthropic和OpenAI SDK，提供call/stream接口和自动重试。
  - types.ts ()
  - anthropic-provider.ts ()
  - openai-provider.ts ()
  - factory.ts ()
  - retry.ts ()
  - index.ts ()
- **状态管理** ⚠️ — 管理项目状态（章节进度、弧线信息）和实体关系图谱，使用SQLite持久化。
  - types.ts ()
  - file-state-manager.ts ()
  - entity-graph.ts ()
  - index.ts ()
  - state.test.ts ()
- **RAG向量库** ⚠️ — 向量数据库抽象层，使用LanceDB存储文档嵌入，支持向量/BM25/混合检索和L0/L1/L2分层读取。
  - types.ts ()
  - lancedb-store.ts ()
  - dashscope-embedding.ts ()
  - layers.ts ()
  - index.ts ()
- **可观测性** — TraceWriter记录管线执行过程中的事件，输出JSONL格式追踪日志。
- **错误定义** — 定义统一的错误类型LisanError和错误码枚举LisanErrorCode。

## Interface Catalog

## Dependency Summary

| Module | Depends On |
|--------|-----------|
| CLI入口 | 管线引擎, 状态管理, 插件系统, LLM抽象层, RAG向量库 |
| 管线引擎 | Agent执行器, 状态管理, 上下文组装, 质量检查, 真相管理器, 可观测性 |
| Agent执行器 | LLM抽象层 |
| 状态管理 | 错误定义 |
| 上下文组装 | RAG向量库, 状态管理 |
| 插件系统 | — |
| 真相管理器 | 状态管理 |
| 质量检查 | 错误定义 |
| 可观测性 | — |
| 错误定义 | — |
| LLM抽象层 | — |
| RAG向量库 | — |
| 网文插件 | 插件系统 |
| 桌面前端 | Tauri后端 |
| Tauri后端 | — |

## Change Risk Guide

- **管线引擎** (HIGH) — 依赖广度：6个模块被此模块调用，是系统核心调度中枢
- **Agent执行器** (HIGH) — 接口暴露：所有LLM交互的唯一通道
- **状态管理** (HIGH) — 数据所有权：拥有SQLite数据库，3个模块读取此模块数据
- **上下文组装** (HIGH) — 依赖广度：被Pipeline调用，同时依赖RAG和State
- **插件系统** (HIGH) — 接口暴露：外部插件通过此接口注入配置
- **真相管理器** (HIGH) — 数据所有权：维护设定一致性数据
- **LLM抽象层** (HIGH) — 接口暴露：所有AI调用的唯一出口，Agent和CLI直接依赖
- **RAG向量库** (HIGH) — 数据所有权：拥有向量数据库，Context模块依赖此模块检索
- **Tauri后端** (HIGH) — 接口暴露：桌面应用的系统级操作入口

## AI Context Block

```yaml
project: Lisan
tier: L
stack: TypeScript + pnpm monorepo + Vercel AI SDK + LanceDB + SQLite + Tauri + React
modules:
  - CLI: CLI入口
  - Pipeline: 管线引擎
  - Agent: Agent执行器
  - State: 状态管理
  - Context: 上下文组装
  - Plugin: 插件系统
  - Truth: 真相管理器
  - Checker: 质量检查
  - Trace: 可观测性
  - Errors: 错误定义
  - LLM: LLM抽象层
  - RAG: RAG向量库
  - WebNovel: 网文插件
  - Desktop: 桌面前端
  - Tauri: Tauri后端
constraints:
  - 所有LLM调用必须经过@lisan/llm抽象层
  - 插件通过BookConfig定义写作风格
  - 管线按固定顺序执行：decompose→plan→write→rewrite
```

## How to Use This Document

When working with AI assistants, reference this document for:

1. **Understanding the architecture** — "Read ARCH.md and explain the module relationships"
2. **Making changes** — "I want to modify [module], what are the risks?"
3. **Adding features** — "Where should I add [feature] based on the current architecture?"
