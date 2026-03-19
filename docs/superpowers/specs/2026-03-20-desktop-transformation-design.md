# Lisan 桌面化全栈改造技术规范

> 版本: 1.0
> 日期: 2026-03-20
> 状态: 待实施

## 1. 概述

### 1.1 目标

将 Lisan 从 CLI 驱动的黑盒写作工具改造为桌面端可视化控制中心。所有智能体、工作流、场景均以可视化方式呈现，作者可在桌面端自由编排工作流、创建智能体、编辑场景卡片、查看章节内容。

### 1.2 核心原则

- **白盒化**：所有 AI 操作对作者透明，以选项卡和卡片形式呈现
- **可编排**：工作流由作者自由定义，智能体可自定义创建
- **标准化**：场景以结构化卡片呈现，不追求生动描述，追求可操作性
- **边界约束**：AI 生成内容不偏离大纲，但中间过程可自由创造

### 1.3 改造范围

- **重写**：@lisan/core → @lisan/engine（核心引擎）
- **重写**：lisan-desktop（桌面端全面重构）
- **新增**：sidecar 通信层
- **复用**：@lisan/llm、@lisan/rag
- **废弃**：@lisan/cli、@lisan/plugin-webnovel（agent 配置迁移为内置预设）

## 2. 系统架构

### 2.1 四层架构

```
┌─────────────────────────────────────────┐
│       lisan-desktop (Tauri 2 + React)   │  表现层
├─────────────────────────────────────────┤
│       sidecar (Node.js 进程)             │  通信层
├─────────────────────────────────────────┤
│       @lisan/engine                      │  引擎层（新）
│  ┌──────────┬───────────┬────────────┐  │
│  │ Workflow  │  Agent    │  Store     │  │
│  │ Runtime   │ Registry  │  Manager   │  │
│  └──────────┴───────────┴────────────┘  │
├─────────────────────────────────────────┤
│     @lisan/llm          @lisan/rag      │  基础设施层（复用）
└─────────────────────────────────────────┘
```

### 2.2 包结构变更

| 包 | 状态 | 说明 |
|---|---|---|
| `@lisan/engine` | 新建 | 取代 @lisan/core，核心引擎 |
| `@lisan/llm` | 保留 | LLM provider 抽象 |
| `@lisan/rag` | 保留 | 向量检索 + embedding |
| `lisan-desktop` | 重构 | Tauri 2 + React 桌面端 |
| `@lisan/core` | 废弃 | 被 @lisan/engine 取代 |
| `@lisan/cli` | 废弃 | 桌面端为唯一入口 |
| `@lisan/plugin-webnovel` | 废弃 | agent 配置迁移为内置预设 |

## 3. Workflow Runtime

### 3.1 工作流定义

工作流是一个有序的线性步骤列表，存储在 SQLite 中。

```typescript
interface WorkflowDefinition {
  id: string;
  projectId: string;               // 所属项目
  name: string;                    // "标准写作流程"
  description: string;
  steps: WorkflowStep[];           // 有序线性列表
  createdAt: string;
  updatedAt: string;
}

interface WorkflowStep {
  id: string;
  order: number;                   // 排序序号，拖拽后重新编号
  agentId: string;                 // 绑定的 agent
  enabled: boolean;                // 可禁用跳过
  config?: StepConfigOverride;     // 步骤级参数覆盖
}

// 步骤级可覆盖的参数
interface StepConfigOverride {
  temperature?: number;
  maxTokens?: number;
  model?: string;                  // 覆盖 agent 默认模型
  provider?: string;               // 覆盖 agent 默认 provider
}
```

### 3.2 执行状态机

每个步骤的生命周期：

```
pending → running → completed | failed | skipped
```

### 3.3 事件流

Runtime 向桌面端推送的事件：

| 事件 | 载荷 | 用途 |
|------|------|------|
| `workflow:start` | workflowId, chapterId | 工作流开始 |
| `step:start` | stepId, agentId | 步骤开始，UI 高亮当前步骤 |
| `step:progress` | stepId, chunk | LLM 流式输出，UI 实时显示 |
| `step:complete` | stepId, output, tokens, duration | 步骤完成 |
| `step:failed` | stepId, error | 步骤失败 |
| `workflow:complete` | chapterId, summary | 工作流结束 |

### 3.4 控制指令

桌面端可发送的控制指令：

| 指令 | 效果 |
|------|------|
| `pause` | 当前 step 完成后暂停 |
| `resume` | 继续执行 |
| `skip` | 跳过当前/指定 step |
| `rerun` | 重跑指定 step，并清除该 step 及其后续所有 step 的输出（因为后续 step 可能依赖其产物） |
| `abort` | 终止整个工作流 |

### 3.5 步骤间数据传递

每个 step 的输出存入 `StepContext`，后续 step 通过模板变量引用前序产物：

- `{{prev.output}}` — 上一步的输出
- `{{step.<stepId>.output}}` — 指定步骤的输出
- `{{context.<key>}}` — 全局上下文变量（场景卡片、章节信息等）

### 3.6 上下文绑定

当工作流为某个章节执行时，Runtime 自动将以下数据注入全局上下文：

- `{{context.scenes}}` — 该章节关联的所有场景卡片（`scenes.chapterId = chapterId`）
- `{{context.chapter}}` — 章节元数据（编号、标题、状态）
- `{{context.previousChapterTail}}` — 上一章末尾内容（用于衔接）
- `{{context.entities}}` — 项目实体图谱（角色、地点等）
- `{{context.outline}}` — 相关大纲段落

当工作流为场景拆解执行时，Runtime 注入：

- `{{context.sourceOutline}}` — 作者选中的大纲段落
- `{{context.existingScenes}}` — 已有的场景卡片（避免重复）
- `{{context.tagTemplate}}` — 项目标签模板定义

### 3.7 并发执行

同一时间只允许一个工作流执行。如果作者在工作流运行中触发另一个操作（如场景拆解），桌面端提示"当前有工作流正在执行，请等待完成或终止后再操作"。

## 4. Agent Registry

### 4.1 Agent 定义

```typescript
interface AgentDefinition {
  id: string;
  name: string;                    // "草稿生成器"
  category: 'builtin' | 'custom';  // 内置 vs 用户自定义
  provider: string;                // "anthropic" | "openai"
  model: string;                   // "claude-opus-4-6" | "gpt-4o"
  temperature: number;
  maxTokens?: number;
  agentMdPath: string;             // agent.md 文件路径（文件系统）
  promptTemplate: string;          // 任务模板，支持 {{key}} 变量注入
  inputSchema: string[];           // 声明需要的输入变量
  createdAt: string;
  updatedAt: string;
}
```

### 4.2 agent.md 与 promptTemplate 的分工

- `agent.md` → system prompt：定义"你是谁、你擅长什么、你的风格原则"。作者用自然语言编写。
- `promptTemplate` → user prompt：定义"这次任务要做什么"，包含 `{{scenes}}`、`{{previousChapterTail}}` 等变量。

```
// 实际发给 LLM 的消息结构
system: {agent.md 的内容}
user:   {promptTemplate 注入变量后的内容}
```

### 4.3 内置预设

从现有 webnovel plugin 迁移 9 个 agent 作为内置预设：

1. Context Agent（上下文组装）
2. Draft Agent（章节初稿）
3. Rewrite Pass 1-5（润色五遍）
4. Review Agent（终审）
5. Data Agent（实体提取）

内置 agent 的 category 为 `builtin`，不可直接编辑。作者可复制为 `custom` 版本后修改。

### 4.4 自定义 Agent 创建

作者通过桌面端创建空白 agent：

1. 填写名称
2. 编写 agent.md（markdown 编辑器）— 核心交互
3. 选择模型（provider + model + temperature 滑块）
4. 编辑 promptTemplate（代码编辑器，{{key}} 变量高亮）
5. 声明 inputSchema
6. 保存

agent.md 示例（作者自定义的战斗润色 agent）：

```markdown
你专门润色战斗场景。
- 增强打击感和速度感
- 用短句制造节奏
- 删除冗余的心理描写
- 动作描写优先使用触觉和听觉
```

## 5. 场景系统

### 5.1 场景卡片数据模型

场景卡片采用"核心字段 + 自定义标签"设计，不绑定特定小说类型。

```typescript
interface SceneCard {
  id: string;
  projectId: string;
  chapterId?: string;              // 归属章节
  parentId?: string;               // 父场景 ID（子场景指向父场景）
  order: number;
  title: string;
  characters: string[];
  location: string;
  eventSkeleton: string[];         // 事件骨架，有序列表
  tags: Record<string, string>;    // 自定义标签
  sourceOutline: string;           // 来源大纲段落原文（边界约束依据）
  createdAt: string;
  updatedAt: string;
}
```

核心字段（所有书通用）：`id, title, order, characters, location, eventSkeleton`

自定义标签（作者按需定义）：通过项目级标签模板配置。

### 5.2 标签模板

作者在项目设置中定义标签模板，控制场景卡片的自定义字段：

```yaml
sceneTagTemplate:
  - key: type
    label: 场景类型
    options: [核心, 铺垫, 释放, 过渡, 余波]
  - key: emotionTask
    label: 情绪任务
  - key: thrillType
    label: 爽点类型
    options: [怒火宣泄, 悲剧, 智商碾压, 战斗快感]
```

标签模板的作用：
- 拆解 Agent 的 prompt 中注入标签要求，AI 生成时自动填充
- 桌面端场景卡片编辑器根据模板渲染表单控件（有 options → 下拉框，无 → 文本输入）

### 5.3 场景拆解工作流

场景拆解本身是一个标准工作流，复用 Workflow Runtime 执行。

```
[拆解 Agent] → [过渡 Agent] → [检验 Agent]
```

| Agent | 职责 | 输入 | 输出 |
|-------|------|------|------|
| 拆解 Agent | 将大纲段落拆成 N 个场景卡片 | 大纲段落 + 项目上下文 | 场景卡片列表 |
| 过渡 Agent | 检查相邻场景衔接，补充过渡信息 | 相邻场景卡片对 | 修正后的场景卡片 |
| 检验 Agent | 验证场景起点终点与大纲一致性 | 大纲段落 + 场景卡片列表 | 通过/不通过 + 偏离说明 |

三个 agent 均为内置预设，作者可复制自定义版本替换。

### 5.4 边界约束模型

- **sourceOutline 字段**：每个场景卡片记录来源大纲原文，作为检验的唯一依据
- **起点/终点不单独建模**：检验 Agent 直接比对 sourceOutline 原文与场景卡片列表的首尾事件，判断是否偏离。不在 SceneCard 上增加 startState/endState 字段，因为"状态"是语义概念，由检验 Agent 从大纲原文中理解，而非结构化提取
- **中间过程**：AI 自由创造事件和任务，不受约束

### 5.5 检验不通过处理

检验 Agent 输出不通过时，桌面端展示偏离说明，作者三选一：

1. **接受** — 偏离可能是好的创造，保留当前结果
2. **手动修改** — 直接编辑场景卡片修正偏离
3. **重新生成** — 重跑拆解工作流

### 5.6 层级拆解

场景支持两级结构：

```
大纲段落
  ├── 场景 A（中等）
  │     ├── 子场景 A.1（小）
  │     └── 子场景 A.2（小）
  ├── 场景 B（中等）
  └── 场景 C（中等）
```

作者可对任意中等场景执行"进一步拆解"，生成子场景（parentId 指向父场景）。

### 5.7 桌面端交互流程

1. 作者在"大纲"选项卡选中一段文字
2. 右键 → "拆解为场景"
3. 选择拆解工作流（默认或自定义）
4. AI 执行拆解工作流，实时显示进度
5. 生成的场景卡片出现在"场景"选项卡
6. 检验不通过 → 弹出偏离说明，作者决策
7. 作者可点击任意场景卡片进一步拆解为子场景
8. 作者可直接编辑任何场景卡片的任何字段

## 6. Store Manager 与数据存储

### 6.1 双轨存储策略

| 存储位置 | 数据类型 | 原因 |
|----------|----------|------|
| SQLite | 工作流定义、Agent 定义、场景卡片、执行记录、项目配置、实体图谱 | 结构化查询 |
| 文件系统 | 章节 markdown、大纲 markdown、agent.md 源文件 | git 友好 |

### 6.2 SQLite 表结构

```sql
-- 项目
projects (id, name, basePath, sceneTagTemplate JSON, createdAt)

-- 工作流
workflows (id, projectId, name, description, createdAt, updatedAt)

-- 工作流步骤（独立表，保证与 execution_steps 的引用完整性）
workflow_steps (id, workflowId, "order", agentId, enabled, config JSON)

-- 智能体（projectId 为 NULL 表示全局内置 agent）
agents (id, projectId NULL, name, category, provider, model, temperature,
        maxTokens, agentMdPath, promptTemplate, inputSchema JSON, createdAt, updatedAt)

-- 场景卡片
scenes (id, projectId, chapterId NULL, parentId NULL, "order", title,
        characters JSON, location, eventSkeleton JSON, tags JSON,
        sourceOutline, createdAt, updatedAt)

-- 章节
chapters (id, projectId, number, title, status, workflowId, contentPath,
          createdAt, updatedAt)

-- 执行记录
executions (id, projectId, chapterId, workflowId, status, startedAt, completedAt)

-- 执行步骤
execution_steps (id, executionId, stepId, agentId, status, input, output,
                 tokens, duration, "order")

-- 实体图谱（复用现有结构）
entities (id, projectId, type, name, data JSON, createdAt, updatedAt)
```

### 6.3 文件系统目录结构

```
{project}/
├── .lisan/
│   ├── lisan.db              ← SQLite 数据库
│   ├── agents/
│   │   ├── {agentId}/
│   │   │   └── agent.md      ← agent 角色定义
│   │   └── ...
│   └── config.yaml           ← 全局配置（LLM API keys 等）
├── outline.md                ← 大纲
├── chapters/
│   ├── 001.md
│   ├── 002.md
│   └── ...
└── scenes.md                 ← 场景分解结果（可选备份）
```

### 6.4 Store Manager API

```typescript
interface StoreManager {
  // 项目
  getProject(id: string): Project;

  // 工作流
  getWorkflows(projectId: string): WorkflowDefinition[];
  saveWorkflow(workflow: WorkflowDefinition): void;
  deleteWorkflow(id: string): void;

  // Agent
  getAgents(projectId?: string): AgentDefinition[];
  saveAgent(agent: AgentDefinition): void;
  deleteAgent(id: string): void;
  getAgentMd(agentId: string): string;
  saveAgentMd(agentId: string, content: string): void;

  // 场景
  getScenes(projectId: string, chapterId?: string): SceneCard[];
  saveScene(scene: SceneCard): void;
  deleteScene(id: string): void;
  reorderScenes(sceneIds: string[]): void;

  // 章节
  getChapters(projectId: string): Chapter[];
  getChapterContent(chapterId: string): string;
  saveChapterContent(chapterId: string, content: string): void;

  // 执行记录
  getExecutions(projectId: string): Execution[];
  getExecutionDetail(executionId: string): ExecutionDetail;
  saveExecution(execution: Execution): void;

  // 实体
  queryEntities(projectId: string, type?: string): Entity[];
}
```

## 7. Sidecar 通信层

### 7.1 架构

```
React UI ←→ Tauri Rust (IPC) ←→ stdin/stdout JSON-RPC ←→ Node.js Sidecar (@lisan/engine)
```

Tauri 主进程（Rust）启动 Node.js sidecar 子进程，通过 stdin/stdout 以 JSON-RPC 2.0 协议双向通信。Rust 端纯透传，不做业务逻辑。

### 7.2 消息协议

```typescript
// 请求（桌面端 → sidecar）
interface Request {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params: Record<string, any>;
}

// 响应（sidecar → 桌面端）
interface Response {
  jsonrpc: "2.0";
  id: number;
  result?: any;
  error?: { code: number; message: string };
}

// 事件推送（sidecar → 桌面端，无 id）
interface Notification {
  jsonrpc: "2.0";
  method: string;
  params: Record<string, any>;
}
```

### 7.3 RPC 方法清单

| 分类 | 方法 | 说明 |
|------|------|------|
| 项目 | `project.open` | 打开项目，初始化 engine |
| 工作流 | `workflow.list` / `save` / `delete` | CRUD |
| 工作流 | `workflow.run` / `pause` / `resume` / `skip` / `rerun` / `abort` | 执行控制 |
| Agent | `agent.list` / `save` / `delete` | CRUD |
| Agent | `agent.getMd` / `saveMd` | agent.md 读写 |
| 场景 | `scene.list` / `save` / `delete` / `reorder` | CRUD + 排序 |
| 章节 | `chapter.list` / `getContent` / `saveContent` | 章节管理 |
| 执行 | `execution.list` / `detail` | 执行记录查询 |
| 实体 | `entity.query` | 实体查询 |

### 7.4 Tauri Rust 端职责

1. 管理 sidecar 进程生命周期（启动、重启、关闭）
2. 将 React 端的 Tauri invoke 转为 JSON-RPC 发给 sidecar
3. 将 sidecar 的 Notification 转为 Tauri event 推给 React 端

### 7.5 Sidecar 崩溃恢复

当 sidecar 进程崩溃时：

1. **执行状态持久化**：每个 step 完成后，Runtime 将执行状态（当前步骤、已完成步骤的输出）写入 SQLite `executions` 和 `execution_steps` 表
2. **Rust 端自动重启**：Tauri 检测到 sidecar 进程退出后自动重启
3. **恢复对话框**：桌面端检测到 sidecar 重启后，查询是否有未完成的执行记录（status = 'running'），弹出恢复对话框，作者选择：
   - **从断点继续** — 跳过已完成的步骤，从失败/中断的步骤重新开始
   - **放弃执行** — 将执行标记为 failed，保留已完成步骤的产物

## 8. 桌面端 UI

### 8.1 整体布局

```
┌──────────────────────────────────────────────────┐
│  ← 项目名称                          设置 ⚙     │
├────────┬─────────────────────────────────────────┤
│        │                                         │
│  大纲  │                                         │
│  场景  │         内容区                           │
│  章节  │         (当前选项卡对应的视图)             │
│  工作流│                                         │
│  智能体│                                         │
│  执行  │                                         │
│        │                                         │
└────────┴─────────────────────────────────────────┘
```

### 8.2 选项卡视图

**大纲**：markdown 编辑器，直接编辑 outline.md。支持选中文字右键"拆解为场景"。

**场景**：卡片网格视图。每张卡片展示核心字段 + 自定义标签。点击展开为可编辑表单。支持按章节筛选。顶部"AI 生成场景"按钮。子场景以缩进或折叠方式展示。

**章节**：左侧章节列表（编号 + 标题 + 状态 badge），右侧 markdown 阅读/编辑器。状态：pending / drafting / rewriting / reviewing / done。"运行"按钮触发写作工作流。

**工作流**：上方下拉选择/新建工作流。下方线性步骤列表，每步是一张卡片（agent 名称 + agent.md 摘要）。支持拖拽排序、添加/删除步骤、启用/禁用 toggle、点击展开覆盖参数。

**智能体**：卡片网格（内置灰色，自定义蓝色）。点击进入编辑页：上半部 agent.md 编辑器，下半部模型选择 + promptTemplate 编辑器。"新建智能体"按钮创建空白 agent。

**执行**：执行历史列表 + 详情。列表显示章节、工作流、状态、时间。详情页展示每个 step 的输入输出、token 消耗、耗时。执行中实时显示 LLM 流式输出。

### 8.3 运行入口

在"章节"选项卡中，选中章节 → 点击"运行" → 选择工作流 → 执行。执行过程中自动跳转到"执行"选项卡实时查看。

## 9. 从现有代码迁移

### 9.1 需要迁移的逻辑

| 现有模块 | 迁移目标 | 说明 |
|----------|----------|------|
| `core/context/context-agent.ts` | engine/context | 上下文组装逻辑，作为内置 agent 的 promptTemplate |
| `core/agent/executor.ts` | engine/agent | 模板注入 + LLM 调用，重新实现 |
| `core/agent/pass-runner.ts` | engine/workflow | 被 Workflow Runtime 取代 |
| `core/state/entity-graph.ts` | engine/store | 实体图谱，迁移到 Store Manager |
| `core/truth/*` | engine/truth | Truth 系统保留，接入 Store Manager |
| `core/checker/*` | engine/checker | Post-write checker 保留 |
| `webnovel/src/index.ts` | engine/presets | 9 个 agent 配置迁移为内置预设 |

### 9.2 不迁移的部分

- CLI 命令层（`cli/src/commands/*`）— 废弃
- Plugin 系统（`core/plugin/*`）— 被 Agent Registry 取代
- Pipeline 硬编码调度（`core/pipeline/*`）— 被 Workflow Runtime 取代

## 10. 技术约束

- **运行时**：Node.js 22+（sidecar）、Tauri 2（桌面端）
- **前端**：React 19、React Router 7、Tailwind CSS 4、shadcn/ui、Zustand
- **数据库**：SQLite（better-sqlite3，WAL 模式）
- **LLM**：Vercel AI SDK（@ai-sdk/anthropic + @ai-sdk/openai）
- **构建**：tsup（ESM + CJS）、pnpm workspace
- **测试**：vitest
