## Context

Lisan 是从 OpenClaw（自定义多 Agent 框架）中解耦出来的独立 CLI 工具。当前系统已在《血色天平》项目中验证（12章生成），核心管线可用，但强依赖 OpenClaw 运行时，无法独立部署。

目标是将其重构为标准化 monorepo，使任何用户都能通过 `npm install -g lisan` 安装并使用。

## Goals / Non-Goals

**Goals:**
- 四个独立 npm 包：`@lisan/llm`、`@lisan/rag`、`@lisan/core`、`@lisan/cli`
- 完整的 `write` 管线（Context Agent + 5 Pass + 终审 + Data Agent）
- 自主创角机制（Context Agent 按场景需要生成配角/路人，不受大纲约束）
- 多 provider LLM 支持（Anthropic / OpenAI，通过 Vercel AI SDK 统一）
- 插件系统（`plugins/webnovel` 作为参考实现）
- 本地嵌入式向量数据库（LanceDB，无需外部服务）

**Non-Goals:**
- Web UI（P3，独立项目）
- 云端部署 / 多用户协作
- 实时协作编辑
- 非中文网文场景的深度优化

## Decisions

### D1: monorepo 用 pnpm workspace，不用 nx/turborepo

**选择**：pnpm workspace + tsup
**理由**：项目规模小（4个包），nx/turborepo 引入的复杂度不值得。tsup 零配置打包 ESM+CJS。
**备选**：nx — 功能强但配置重，适合大型团队项目。

### D2: LLM 统一接口用 Vercel AI SDK，不用 LiteLLM

**选择**：`ai` package（Vercel AI SDK）
**理由**：TypeScript 原生，类型安全，`streamText` 对长文本生成必要，支持 Anthropic/OpenAI/本地模型。LiteLLM 是 Python 生态。
**备选**：直接用各 provider SDK — provider 切换成本高。

### D3: 向量数据库用 LanceDB（嵌入式），不用 ChromaDB

**选择**：LanceDB
**理由**：嵌入式运行，无需启动外部服务，已在 OpenViking 中验证，支持混合检索（向量 + BM25）。
**备选**：ChromaDB — 需要独立进程，增加部署复杂度。

### D4: 自主创角的持久化策略分三级

**选择**：`chapter`（一次性）/ `arc`（弧线内复用）/ `permanent`（长期角色）
**理由**：路人不应污染实体图谱，但有潜力的配角需要跨章保持一致性。三级策略平衡了灵活性和图谱整洁度。
**备选**：全部写入图谱 — 图谱膨胀，检索噪声增加。

### D5: 5 Pass 串行执行，不并行

**选择**：串行
**理由**：每个 Pass 的输入是上一个 Pass 的输出，存在数据依赖，无法并行。
**备选**：并行 — 逻辑上不可行。

### D6: 配置格式 YAML + Markdown，不用纯 JSON

**选择**：YAML（流程配置）+ Markdown（Agent 定义、参考文件）
**理由**：YAML 人类可读可编辑，Markdown 让 Agent 定义文件本身就是可读文档，与现有 skills/ 目录结构一致。
**备选**：纯 JSON — 不适合人工编辑的长文本内容。

## Risks / Trade-offs

- **LLM API 不稳定** → 指数退避重试（p-retry，最多3次）+ 每个 Agent 独立超时（180-300s）
- **长篇小说 context 超限** → 三层渐进式读取（L0/L1/L2）+ RAG 按需检索，禁止无脑读全文
- **自主创角一致性** → `arc`/`permanent` 级角色写入实体图谱，后续章节 Context Agent 优先检索已有角色
- **5 Pass 成本高** → 编排器用强模型（Claude Opus），执行器可配置为性价比模型（GPT-4o）；Pass 可单独重跑
- **插件系统过度设计** → P2 再实现，P0/P1 先硬编码 webnovel 插件，接口预留但不强制抽象

## Migration Plan

1. P0：搭 monorepo 骨架，实现 `@lisan/llm` + `@lisan/rag` + 状态管理，单元测试覆盖
2. P1：实现完整 `write` 管线，替代现有 OpenClaw 工作流，端到端测试
3. P2：实现 `decompose` + `plan` 管线，插件系统
4. 回滚：OpenClaw 工作流保持不变，Lisan 并行运行直到 P1 验证通过

## Open Questions

- `permanent` 级自主创角是否需要人工确认才能写入实体图谱？（建议：默认写入，标记 `needsReview: true`，`status` 命令展示待审查角色列表）
- embedding 模型是否需要支持离线/本地模型？（当前依赖 DashScope，P2 再考虑）
- `write --batch` 的并发策略：章节间是否可以并行？（上一章结尾500字是依赖，需串行；但不同弧线可并行）
