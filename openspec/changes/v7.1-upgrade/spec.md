# Lisan v7.1 升级计划 Spec

> 版本: v7.0 → v7.1
> 日期: 2026-03-18
> 状态: Draft

---

## 1. 概述

本次升级基于 bloodscale v7.1（OpenClaw workspace-writer）的功能对齐分析，为 Lisan 补齐三项核心缺失能力：

| # | 功能 | 优先级 | 预估工作量 |
|---|------|--------|-----------|
| F1 | 确定性后验证器（Post-Write Checker） | P0 | 2d |
| F2 | 真相文件体系（Truth Files） | P0 | 3d |
| F3 | 写前自检 / 写后结算（PRE_WRITE_CHECK / POST_SETTLEMENT） | P1 | 2d |

实施顺序：F1 → F2 → F3（F3 依赖 F2 的真相文件）。

---

## 2. F1 — 确定性后验证器（Post-Write Checker）

### 2.1 目标

在 Draft Agent 输出初稿后、Pass 改写链之前，插入一步零 LLM 成本的确定性规则检查。检查结果（违规清单）注入后续每个 Pass 的 prompt，引导 LLM 定向修复。

### 2.2 新增模块

**文件**: `packages/core/src/checker/post-write-checker.ts`

```typescript
export interface CheckViolation {
  rule: string;        // 规则 ID，如 "dash-frequency"
  severity: 'error' | 'warning';
  message: string;     // 人类可读描述
  locations: number[]; // 违规段落索引（0-based）
}

export interface CheckResult {
  errors: CheckViolation[];
  warnings: CheckViolation[];
  summary: string;     // 注入 Pass prompt 的摘要文本
}

export function checkDraft(draft: string): CheckResult;
```

### 2.3 检查规则（11 条）

| # | 规则 ID | 检查内容 | 阈值 | 严重度 |
|---|---------|---------|------|--------|
| 1 | `not-but-pattern` | "不是……而是……"句式频率 | ≥3次/章 | warning |
| 2 | `dash-frequency` | 破折号（——）使用频率 | ≥5次/章 | warning |
| 3 | `transition-words` | 转折标记词（然而/但是/不过/却）频率 | ≥8次/章 | warning |
| 4 | `meta-narrative` | 元叙事检测（"这个世界"/"在这片大陆"等上帝视角用语） | ≥1次 | error |
| 5 | `academic-tone` | 分析术语检测（"本质上"/"从某种意义上"等论文腔） | ≥1次 | error |
| 6 | `preachy-words` | 说教词检测（"应该"/"必须"/"不得不"等） | ≥3次/章 | warning |
| 7 | `collective-shock` | 集体震惊检测（"所有人都"/"众人纷纷"等） | ≥2次/章 | warning |
| 8 | `emotion-labeling` | 情绪标签检测（"他感到愤怒"/"她心中一喜"等直接命名情绪） | ≥3次/章 | warning |
| 9 | `equal-paragraphs` | 段落等长检测（连续≥3段字数差<15%） | 连续3段 | warning |
| 10 | `same-start` | 连续相同开头检测（连续≥2段以相同词开头） | 连续2段 | warning |
| 11 | `trailing-le` | 连续"了"字检测（连续≥3句句尾为"了"） | 连续3句 | warning |

实现方式：纯字符串 + 正则操作，零 LLM 依赖。规则阈值通过 `BookConfig` 可配置（后续迭代）。

### 2.4 管线集成

**WritePipeline** — 在 Step 2（Draft Agent）和 Step 3（Pass 链）之间新增 Step 2.5：

```
Step 1: Context Agent → contextPack
Step 2: Draft Agent → initialDraft
Step 2.5: Post-Write Checker → checkResult   ← 新增
Step 3: Pass 链（每个 Pass prompt 注入 checkResult.summary）
Step 4: Review Agent
Step 5: Data Agent
Step 6: Git commit
```

**RewritePipeline** — 在 Step 2（读取正文）和 Step 3（Pass 链）之间新增同样的检查。

### 2.5 PassInput 接口变更

```typescript
// packages/core/src/pipeline/types.ts
export interface PassInput {
  draft: string;
  contextPack: ContextPack;
  chapterNumber: number;
  checkerSummary?: string;  // ← 新增：违规清单摘要
}
```

`PassRunner.runAll()` 和 `PassRunner.rerunPass()` 签名新增可选参数 `checkerSummary?: string`。

`AgentPass.execute()` 在 `context.instructions` 末尾追加 `checkerSummary`（非空时）。

### 2.6 测试计划

- `packages/core/src/checker/post-write-checker.test.ts`：每条规则至少 2 个用例（触发 + 不触发），共 ≥22 个测试
- `packages/core/src/pipeline/pipeline.test.ts`：新增集成测试验证 checker 结果注入 Pass prompt

### 2.7 导出

`packages/core/src/checker/index.ts` 导出 `checkDraft`、`CheckResult`、`CheckViolation`。
`packages/core/src/index.ts` 新增 `export * from './checker/index.js'`。

---

## 3. F2 — 真相文件体系（Truth Files）

### 3.1 目标

建立章与章之间的连续性管控机制。在项目根目录下维护 `truth/` 目录，包含世界状态快照、伏笔追踪表、角色交互矩阵三个文件，由管线自动读取和更新。

### 3.2 文件结构

```
<projectRoot>/
  truth/
    current_state.md      — 世界状态快照
    pending_hooks.md      — 伏笔追踪表
    character_matrix.md   — 角色交互矩阵
```

### 3.3 文件格式定义

**`truth/current_state.md`**:
```markdown
# 世界状态快照
> 最后更新: 第 N 章

## 主角状态
- 位置: ...
- 身体状态: ...
- 持有物品: ...

## 关键NPC状态
| NPC | 位置 | 状态 | 最后出现章节 |
|-----|------|------|-------------|

## 势力格局
...

## 时间线
| 章节 | 时间 | 事件 |
|------|------|------|
```

**`truth/pending_hooks.md`**:
```markdown
# 伏笔追踪表
> 最后更新: 第 N 章

## 活跃伏笔
| 编号 | 描述 | 埋设章节 | 预计回收 | 滞留标记 |
|------|------|---------|---------|---------|

## 已回收伏笔
| 编号 | 描述 | 埋设章节 | 回收章节 |
|------|------|---------|---------|
```

**`truth/character_matrix.md`**:
```markdown
# 角色交互矩阵
> 最后更新: 第 N 章

## 信息边界
| 角色 | 知道什么 | 不知道什么 |
|------|---------|-----------|

## 关系状态
| 角色A | 角色B | 关系 | 最后交互章节 |
|-------|-------|------|-------------|
```

### 3.4 新增模块

**文件**: `packages/core/src/truth/truth-manager.ts`

```typescript
export interface TruthFiles {
  currentState: string;
  pendingHooks: string;
  characterMatrix: string;
}

export class TruthManager {
  constructor(private readonly projectRoot: string);

  /** 读取全部真相文件，返回拼接摘要 */
  async read(): Promise<TruthFiles>;

  /** 生成注入 prompt 的真相摘要 */
  async buildSummary(): Promise<string>;

  /** 用 LLM 输出的结算块更新真相文件 */
  async applySettlement(settlement: SettlementData, chapterNumber: number): Promise<void>;

  /** 扫描滞留伏笔（>10章未回收），自动标记 */
  async markStaleHooks(currentChapter: number): Promise<number>;
}
```

**文件**: `packages/core/src/truth/types.ts`

```typescript
export interface SettlementData {
  characterInteractions: CharacterInteraction[];
  hookChanges: HookChange[];
  worldStateChanges: WorldStateChange[];
  upgradeEvents: UpgradeEvent[];
}

export interface CharacterInteraction {
  characters: string[];
  type: 'first_meet' | 'info_gain' | 'relation_change';
  description: string;
}

export interface HookChange {
  action: 'plant' | 'resolve';
  hookId?: string;
  description: string;
  expectedResolution?: number; // 预计回收章节
}

export interface WorldStateChange {
  category: 'location' | 'item' | 'body' | 'faction';
  description: string;
}

export interface UpgradeEvent {
  type: 'ability' | 'skill' | 'resource';
  description: string;
}
```

### 3.5 管线集成

**ContextAgent.buildContextPack()**:
- 新增步骤 7：调用 `TruthManager.buildSummary()` 读取真相文件摘要
- `ContextPack` 接口新增字段 `truthSummary: string`

**WritePipeline Step 5（Data Agent）**:
- Data Agent prompt 新增指令：解析 POST_SETTLEMENT 块
- 调用 `TruthManager.applySettlement()` 更新真相文件
- 调用 `TruthManager.markStaleHooks()` 标记滞留伏笔

**init 命令**:
- 创建 `truth/` 目录及三个模板文件

### 3.6 ContextPack 接口变更

```typescript
// packages/core/src/context/types.ts
export interface ContextPack {
  // ... 现有字段
  truthSummary: string;  // ← 新增
}
```

### 3.7 测试计划

- `packages/core/src/truth/truth-manager.test.ts`：
  - `read()` 正常读取 / 文件不存在时返回空模板
  - `buildSummary()` 摘要格式验证
  - `applySettlement()` 各类变更写入验证
  - `markStaleHooks()` 滞留标记逻辑
  - 共 ≥10 个测试

### 3.8 导出

`packages/core/src/truth/index.ts` 导出 `TruthManager` 及所有类型。
`packages/core/src/index.ts` 新增 `export * from './truth/index.js'`。

---

## 4. F3 — 写前自检 / 写后结算（PRE_WRITE_CHECK / POST_SETTLEMENT）

### 4.1 目标

改造 Draft Agent 的 prompt 为三阶段输出：自检 → 正文 → 结算。自检确保 LLM 动笔前核对真相文件，结算确保写完后输出结构化变更数据供 Data Agent 消费。

### 4.2 Draft Agent Prompt 改造

Draft Agent 的 `userPrompt` 新增三阶段指令：

```
=== 阶段一：写前自检（PRE_WRITE_CHECK） ===
在动笔前，请先输出以下检查块（用 ```pre-check 围栏标记）：
1. 上下文确认：本章场景列表、情绪任务、爽点类型
2. 世界状态核对：主角位置/状态/物品（对照真相文件）
3. 信息边界检查：出场角色各自知道/不知道什么
4. 伏笔检查：本章需回收/新埋的伏笔
5. 风险扫描：可能出错的点

=== 阶段二：正文 ===
（正常起草指令，用 ```chapter 围栏标记）

=== 阶段三：写后结算（POST_SETTLEMENT） ===
正文写完后，请追加结算块（用 ```settlement 围栏标记，JSON 格式）：
{
  "characterInteractions": [...],
  "hookChanges": [...],
  "worldStateChanges": [...],
  "upgradeEvents": [...]
}
```

### 4.3 输出解析器

**文件**: `packages/core/src/pipeline/draft-parser.ts`

```typescript
export interface DraftParseResult {
  preCheck: string;           // 自检块原文
  chapter: string;            // 正文内容
  settlement: SettlementData; // 结算数据（已解析 JSON）
}

/** 从 Draft Agent 三阶段输出中解析各块 */
export function parseDraftOutput(raw: string): DraftParseResult;
```

使用围栏代码块标记（` ```pre-check `、` ```chapter `、` ```settlement `）分割三个阶段。

### 4.4 管线集成

**WritePipeline Step 2（Draft Agent）**:
- prompt 注入真相文件摘要（`contextPack.truthSummary`）
- prompt 追加三阶段指令
- 输出通过 `parseDraftOutput()` 解析
- `preCheck` 写入 trace 日志
- `chapter` 作为初稿进入后续 Pass 链
- `settlement` 暂存，在 Step 5 传给 Data Agent

**WritePipeline Step 5（Data Agent）**:
- 接收 `settlement` 数据
- 调用 `TruthManager.applySettlement(settlement, chapterNumber)` 更新真相文件
- 原有实体提取逻辑保留

### 4.5 测试计划

- `packages/core/src/pipeline/draft-parser.test.ts`：
  - 正常三阶段解析
  - 缺少某阶段的降级处理
  - settlement JSON 格式错误的容错
  - 共 ≥6 个测试
- `packages/core/src/pipeline/pipelines.test.ts`：
  - 新增集成测试验证三阶段流程端到端

---

## 5. 跨功能变更汇总

### 5.1 接口变更

| 文件 | 变更 |
|------|------|
| `core/src/pipeline/types.ts` | `PassInput` 新增 `checkerSummary?: string` |
| `core/src/context/types.ts` | `ContextPack` 新增 `truthSummary: string` |
| `core/src/plugin/types.ts` | `BookConfig` 新增 `truthDir?: string`（可选，默认 `truth/`） |

### 5.2 新增文件

| 文件 | 说明 |
|------|------|
| `core/src/checker/post-write-checker.ts` | 确定性规则检查器 |
| `core/src/checker/post-write-checker.test.ts` | 检查器测试 |
| `core/src/checker/index.ts` | 导出 |
| `core/src/truth/truth-manager.ts` | 真相文件管理器 |
| `core/src/truth/types.ts` | 真相文件类型定义 |
| `core/src/truth/truth-manager.test.ts` | 真相文件测试 |
| `core/src/truth/index.ts` | 导出 |
| `core/src/pipeline/draft-parser.ts` | Draft 三阶段输出解析器 |
| `core/src/pipeline/draft-parser.test.ts` | 解析器测试 |

### 5.3 修改文件

| 文件 | 变更 |
|------|------|
| `core/src/pipeline/write-pipeline.ts` | 插入 Step 2.5 checker + Step 2 三阶段 prompt + Step 5 结算处理 |
| `core/src/pipeline/rewrite-pipeline.ts` | 插入 checker 步骤 |
| `core/src/pipeline/pass-runner.ts` | `runAll`/`rerunPass` 支持 `checkerSummary` |
| `core/src/context/context-agent.ts` | `buildContextPack` 新增真相文件读取 |
| `core/src/context/types.ts` | `ContextPack` 新增字段 |
| `core/src/plugin/types.ts` | `BookConfig` 新增 `truthDir` |
| `core/src/index.ts` | 新增导出 |
| `cli/src/commands/init.ts` | 创建 `truth/` 目录和模板文件 |

### 5.4 不变更

- `@lisan/llm` — 无需改动
- `@lisan/rag` — 无需改动
- `@lisan/plugin-webnovel` — 暂不改动（后续迭代可配置 checker 阈值）

---

## 6. 实施计划

### Phase 1: 确定性后验证器（Day 1-2）

1. 实现 `post-write-checker.ts`（11 条规则）
2. 编写测试（≥22 个用例）
3. 修改 `PassInput` 接口 + `PassRunner` 签名
4. 集成到 `WritePipeline` 和 `RewritePipeline`
5. 运行全量测试，确保无回归

### Phase 2: 真相文件体系（Day 3-5）

1. 定义 `truth/types.ts` 类型
2. 实现 `TruthManager`（read/buildSummary/applySettlement/markStaleHooks）
3. 编写测试（≥10 个用例）
4. 修改 `ContextAgent` 集成真相文件读取
5. 修改 `init` 命令创建 truth/ 目录
6. 运行全量测试

### Phase 3: 写前自检 / 写后结算（Day 6-7）

1. 实现 `draft-parser.ts`
2. 编写测试（≥6 个用例）
3. 改造 `WritePipeline` Step 2 的 Draft Agent prompt
4. 改造 `WritePipeline` Step 5 的 Data Agent 消费结算数据
5. 集成测试端到端验证
6. 运行全量测试

### Phase 4: 收尾（Day 8）

1. 全量构建 `pnpm build`，确保零错误
2. 全量测试 `pnpm test`，确保全部通过
3. 更新 `ARCHITECTURE.md`
4. 更新 `v7.1-gaps.md` 标记已完成

---

## 7. 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| Draft Agent 不遵循三阶段格式 | F3 解析失败 | `parseDraftOutput` 实现降级逻辑：缺少围栏时将整个输出视为正文，settlement 为空 |
| 真相文件过大导致 prompt 超长 | token 浪费 | `TruthManager.buildSummary()` 实现截断策略，限制摘要 ≤2000 字 |
| checker 规则误报率高 | Pass 被无效指令干扰 | 阈值保守设定，仅 error 级别强制注入，warning 级别可配置是否注入 |
| 现有测试因接口变更失败 | 回归 | `PassInput.checkerSummary` 和 `ContextPack.truthSummary` 均为可选字段，向后兼容 |
