# 全量改动行动清单（人类主导写作重构）

> 目标：将当前 `Engine + Desktop + Sidecar` 体系改造成“作者主导、AI 适配”的写作产品；落地核心能力包括：
> 1) 可编辑的故事驾驶舱 `md` 真相文件；
> 2) 按大纲区段选择生成与重生成（非一键全量）；
> 3) 先生成无修辞场景草稿，用户改稿后再走润色工作流；
> 4) VSCode 插件优先体验，桌面端降级为兼容与运维入口。

## 背景

当前代码库在以下位置体现了“流程强约束、作者自由度不足”的实现路径：

- 场景输出在运行时被固定 schema 约束：`packages/engine/src/workflow/runtime.ts`
- 场景编辑以结构化表单为主：`lisan-desktop/src/components/SceneEditForm.tsx`
- 信息架构以流程分栏为中心：`lisan-desktop/src/App.tsx`、`lisan-desktop/src/layouts/ProjectLayout.tsx`
- 当前主链路缺少“按大纲区段增量生成 + AI 适配用户改稿”的原生模型

本清单按“先协议与数据、再能力、再客户端、最后发布”的顺序组织，确保 agent team 可直接拆分执行。

## 总体执行策略

1. **先定真相源**：用 `md` 文件与统一数据模型定义“故事在讲什么、为什么这样讲”。
2. **先保兼容再重构**：新增能力优先通过新接口并保持旧接口可用，避免一次性破坏旧项目。
3. **写作优先于流程**：把“场景/章节/工作流管理”从入口变为增强能力。
4. **双端并行推进**：VSCode 插件作为主创作端，Desktop 保留项目管理/监控/高级配置。
5. **迁移可回滚**：每一阶段都要求可回退脚本、数据快照和灰度验证。

---

## 分阶段任务清单

### 阶段 A：基线与协议（必须先完成）

### - [ ] T01 基线冻结与改造边界确认
- 任务名称：基线冻结与改造边界确认
- 目标说明：冻结当前功能基线和关键行为，避免后续任务目标漂移。
- 涉及范围（文件、目录、模块、服务）：`ARCHITECTURE.md`、`docs/CODE_REFERENCE.md`、`docs/RPC_REFERENCE.md`、`docs/INTERFACE_CATALOG.md`、`docs/OPERATION_MANUAL.md`
- 执行动作：
1. 记录当前可用能力、已知限制、不可回退约束。
2. 生成“改造范围与非目标”清单并在仓库文档固化。
3. 建立任务编号规范（T01~T26）供 agent team 追踪。
- 前置依赖：无
- 是否可并发（是/否）：否
- 并发分组编号：S-01
- 验收标准：基线文档可直接回答“当前怎么跑、这次不做什么、哪些行为必须兼容”。
- 建议负责人角色：产品负责人（Product Owner）+ 技术负责人（Tech Lead）

### - [ ] T02 人类主导写作 PRD 与用户旅程固化
- 任务名称：人类主导写作 PRD 与用户旅程固化
- 目标说明：把需求转成可执行的用户旅程和验收指标。
- 涉及范围（文件、目录、模块、服务）：新增 `docs/product/human-first-writing-prd.md`、`docs/product/user-journeys.md`
- 执行动作：
1. 固化关键场景：50k 大纲导入、按区段生成、重生成、改稿、润色。
2. 定义成功标准（结构偏移率、重生成效率、改稿后适配准确率）。
3. 定义“写作入口优先、流程增强次之”的产品原则。
- 前置依赖：T01
- 是否可并发（是/否）：否
- 并发分组编号：S-02
- 验收标准：PRD 与旅程文档可直接映射到工程任务，不存在歧义字段。
- 建议负责人角色：产品负责人 + 写作体验设计师（UX Writer/Designer）

### - [ ] T03 新项目文件协议与命名规范
- 任务名称：新项目文件协议与命名规范
- 目标说明：定义未来写作项目目录、核心 `md` 文件和兼容策略。
- 涉及范围（文件、目录、模块、服务）：新增 `docs/specs/project-file-protocol.md`，影响 `packages/engine`、`packages/cli`、`lisan-desktop`、新 VSCode 插件
- 执行动作：
1. 定义 `故事驾驶舱/`、`草稿/场景/`、`草稿/章节/` 的目录协议。
2. 定义核心文件：`story-cockpit.md`、`segment-index.md`、`draft-scene-*.md`。
3. 定义旧目录（`大纲/`、`场景树/`、`chapters/`）的映射与迁移规则。
- 前置依赖：T02
- 是否可并发（是/否）：否
- 并发分组编号：S-03
- 验收标准：协议文档可指导任一 agent 独立实现读写，不需要口头补充。
- 建议负责人角色：领域架构师（Domain Architect）

### 阶段 B：Engine/Sidecar 核心能力（可分组并发）

### - [ ] T04 领域类型重构（故事驾驶舱/区段/草稿）
- 任务名称：领域类型重构（故事驾驶舱/区段/草稿）
- 目标说明：在类型层明确新对象模型，作为后续实现统一契约。
- 涉及范围（文件、目录、模块、服务）：`packages/engine/src/types.ts`、`lisan-desktop/src/types/engine.ts`、新增 `packages/app-client/src/types.ts`
- 执行动作：
1. 新增 `StoryCockpit`、`OutlineSegment`、`SceneDraft`、`DraftRevision` 等类型。
2. 增加场景草稿阶段字段（plain/polish/user-edited）。
3. 增加“区段生成任务”元数据结构（jobId/status/errors/sourceHash）。
- 前置依赖：T03
- 是否可并发（是/否）：是
- 并发分组编号：P-01
- 验收标准：前后端与 SDK 类型一致、可编译、无隐式 `any` 逃逸。
- 建议负责人角色：Engine 工程师（Domain Model Owner）

### - [ ] T05 故事驾驶舱（`md` 真相文件）服务化
- 任务名称：故事驾驶舱（`md` 真相文件）服务化
- 目标说明：实现 AI 与作者共编辑的真相文件读写与版本跟踪。
- 涉及范围（文件、目录、模块、服务）：新增 `packages/engine/src/story/story-cockpit.ts`、`packages/engine/src/story/story-cockpit.test.ts`，修改 `packages/engine/src/store/store-manager.ts`
- 执行动作：
1. 提供 cockpit 文件解析、序列化、冲突提示能力。
2. 支持“AI 建议补丁”与“用户确认写入”两阶段写入。
3. 引入 cockpit 历史版本快照（最少最近 N 次）。
- 前置依赖：T03
- 是否可并发（是/否）：是
- 并发分组编号：P-01
- 验收标准：用户可直接改 `md`，系统下次运行正确吸收且不覆盖人工改动。
- 建议负责人角色：Engine 工程师（File Source-of-Truth）

### - [ ] T06 大纲区段索引器与选择生成入口
- 任务名称：大纲区段索引器与选择生成入口
- 目标说明：支持按标题层级/手选范围生成与重生成。
- 涉及范围（文件、目录、模块、服务）：新增 `packages/engine/src/story/outline-segmenter.ts`、`packages/engine/src/story/outline-segmenter.test.ts`，修改 `packages/engine/src/workflow/context-builder.ts`
- 执行动作：
1. 从 `大纲/arc-1.md` 生成稳定 segmentId（标题路径 + 文本哈希）。
2. 输出 `segment-index.md` 与结构化索引对象。
3. 支持 segment 级别的 re-run 与差异提示。
- 前置依赖：T03
- 是否可并发（是/否）：是
- 并发分组编号：P-01
- 验收标准：同一段落重跑 ID 稳定；大纲局部改动仅影响相关区段。
- 建议负责人角色：Engine 工程师（Parsing/Indexing）

### - [ ] T07 无修辞场景草稿生成域模型
- 任务名称：无修辞场景草稿生成域模型
- 目标说明：将“先结构后文笔”固化成可执行流程与草稿形态。
- 涉及范围（文件、目录、模块、服务）：`packages/engine/src/workflow/runtime.ts`、新增 `packages/engine/src/story/scene-draft.ts`、`packages/engine/src/story/scene-draft.test.ts`
- 执行动作：
1. 新增 plain draft 输出模板（目标/冲突/转折/结果/情绪值）。
2. 将“润色”从默认流程剥离为可选后置步骤。
3. 增加草稿状态机（generated -> user_edited -> polish_ready -> polished）。
- 前置依赖：T04
- 是否可并发（是/否）：是
- 并发分组编号：P-02
- 验收标准：可单独产出结构化草稿，不依赖立即润色。
- 建议负责人角色：Engine 工程师（Workflow Runtime）

### - [ ] T08 路人/配角功能型自动生成器
- 任务名称：路人/配角功能型自动生成器
- 目标说明：基于剧情功能自动补人，而非随机角色堆叠。
- 涉及范围（文件、目录、模块、服务）：新增 `packages/engine/src/story/support-cast-generator.ts`、`packages/engine/src/story/support-cast-generator.test.ts`，修改 `packages/engine/src/workflow/context-builder.ts`
- 执行动作：
1. 定义角色功能类型（阻力、信息、对照、诱发冲突）。
2. 生成角色时绑定“服务主线理由”与“登场约束”。
3. 将角色补全写入草稿元数据与 cockpit 建议区。
- 前置依赖：T05、T06、T07
- 是否可并发（是/否）：是
- 并发分组编号：P-02
- 验收标准：每个新增角色都有明确剧情功能说明，可追溯来源区段。
- 建议负责人角色：Prompt/Narrative Engineer

### - [ ] T09 用户改稿差异感知与 AI 适配
- 任务名称：用户改稿差异感知与 AI 适配
- 目标说明：用户改草稿后，AI 自动更新后续上下文而不是反向约束用户。
- 涉及范围（文件、目录、模块、服务）：新增 `packages/engine/src/story/draft-diff-adapter.ts`、`packages/engine/src/story/draft-diff-adapter.test.ts`，修改 `packages/engine/src/workflow/context-builder.ts`
- 执行动作：
1. 比较草稿历史版本，提取剧情级变更（角色关系/事件顺序/情绪目标）。
2. 生成“上下文修订建议”并写回 cockpit 建议区。
3. 下一次生成自动读取已确认修订。
- 前置依赖：T05、T07
- 是否可并发（是/否）：是
- 并发分组编号：P-02
- 验收标准：用户修改后再次生成不回滚核心改动，偏航率显著下降。
- 建议负责人角色：Engine 工程师（Diff/Context）

### - [ ] T10 工作流宏模板化（可选增强）
- 任务名称：工作流宏模板化（可选增强）
- 目标说明：把工作流从“强制门禁”改为“可保存宏命令”。
- 涉及范围（文件、目录、模块、服务）：`packages/engine/src/workflow/defaults.ts`、`packages/engine/src/workflow/runtime.ts`、`packages/engine/src/store/store-manager.ts`
- 执行动作：
1. 引入宏模板类型（generate_plain / polish / consistency_check）。
2. 允许在章节/区段手动调用某个宏，而非固定整条流水线。
3. 保留旧工作流兼容层。
- 前置依赖：T07
- 是否可并发（是/否）：是
- 并发分组编号：P-02
- 验收标准：用户可独立触发任意宏步骤，旧工作流仍可运行。
- 建议负责人角色：Workflow Engineer

### - [ ] T11 数据库迁移与历史项目回填
- 任务名称：数据库迁移与历史项目回填
- 目标说明：保证新模型落地并兼容旧库数据。
- 涉及范围（文件、目录、模块、服务）：`packages/engine/src/store/database.ts`、`packages/engine/src/store/store-manager.ts`、新增 `packages/engine/src/store/migrations/*`
- 执行动作：
1. 新增表/列：segment、draft、revision、generation_job、cockpit_snapshot。
2. 编写一次性回填逻辑：旧 scenes/chapters -> 新草稿结构。
3. 编写迁移幂等测试与失败回滚策略。
- 前置依赖：T04、T05、T06、T07、T08、T09、T10
- 是否可并发（是/否）：否
- 并发分组编号：S-04
- 验收标准：旧项目升级后可继续写作，且不丢历史内容。
- 建议负责人角色：数据迁移工程师（DB Migration Owner）

### - [ ] T12 Store/Repository 能力补齐
- 任务名称：Store/Repository 能力补齐
- 目标说明：为客户端和脚本提供完整增删改查能力。
- 涉及范围（文件、目录、模块、服务）：`packages/engine/src/store/store-manager.ts`、`packages/engine/src/store/store-manager.test.ts`
- 执行动作：
1. 增加 cockpit、segment、draft、job 读写接口。
2. 增加 segment 粒度的生成任务查询接口。
3. 增加 revision 历史分页与过滤。
- 前置依赖：T11
- 是否可并发（是/否）：是
- 并发分组编号：P-03
- 验收标准：仓储接口覆盖新模型全生命周期，测试通过。
- 建议负责人角色：Engine 工程师（Repository）

### - [ ] T13 Sidecar RPC 新接口与兼容映射
- 任务名称：Sidecar RPC 新接口与兼容映射
- 目标说明：暴露新能力并确保旧方法不立即失效。
- 涉及范围（文件、目录、模块、服务）：`packages/engine/src/sidecar/main.ts`、`packages/engine/src/sidecar/rpc-server.ts`、`docs/RPC_REFERENCE.md`
- 执行动作：
1. 新增 `story.cockpit.*`、`outline.segment.*`、`draft.scene.*`、`generation.job.*`。
2. 对旧 `workflow.run` 提供向后映射和提示。
3. 增加 RPC 错误码语义（冲突、锁定、版本不一致）。
- 前置依赖：T11
- 是否可并发（是/否）：是
- 并发分组编号：P-03
- 验收标准：新旧客户端均可访问；接口文档与实现一致。
- 建议负责人角色：API/Sidecar 工程师

### - [ ] T14 Tauri Command 与前端 Hook 扩展
- 任务名称：Tauri Command 与前端 Hook 扩展
- 目标说明：让 Desktop 可调用新接口并保留兼容回退。
- 涉及范围（文件、目录、模块、服务）：`lisan-desktop/src-tauri/src/commands/mod.rs`、`lisan-desktop/src/hooks/useSidecar.ts`、`lisan-desktop/src/types/engine.ts`
- 执行动作：
1. 新增对应 command：cockpit、segment、draft、job。
2. 在 `useSidecar` 中补齐 API 包装。
3. 保留 `method not found` 的降级提示。
- 前置依赖：T13
- 是否可并发（是/否）：是
- 并发分组编号：P-04
- 验收标准：Desktop 能调用所有新能力，错误提示可理解。
- 建议负责人角色：Desktop 平台工程师（Tauri Bridge）

### - [ ] T15 抽取共享客户端 SDK（Desktop/VSCode 共用）
- 任务名称：抽取共享客户端 SDK（Desktop/VSCode 共用）
- 目标说明：避免双端重复实现 RPC 语义与类型映射。
- 涉及范围（文件、目录、模块、服务）：新增 `packages/app-client/*`，调整 `lisan-desktop/src/hooks/useSidecar.ts`，后续供 VSCode 插件使用
- 执行动作：
1. 抽取请求层、错误层、类型层。
2. 提供 Tauri transport 与 Node IPC transport 适配。
3. 补齐 SDK 单元测试。
- 前置依赖：T13
- 是否可并发（是/否）：是
- 并发分组编号：P-04
- 验收标准：Desktop 与 VSCode 可共享 1 套 client API，行为一致。
- 建议负责人角色：平台工程师（Shared Infra）

### 阶段 C：客户端改造（Desktop 兼容 + VSCode 主入口）

### - [ ] T16 Desktop 写作优先入口重构
- 任务名称：Desktop 写作优先入口重构
- 目标说明：将默认入口从“流程页”改为“写作页 + 区段生成”。
- 涉及范围（文件、目录、模块、服务）：`lisan-desktop/src/App.tsx`、`lisan-desktop/src/layouts/ProjectLayout.tsx`、新增 `lisan-desktop/src/pages/WriterPage.tsx`
- 执行动作：
1. 新增 Writer 入口页（区段选择、生成、重生成、草稿编辑入口）。
2. 调整导航优先级，降低 workflow/scenes 的默认权重。
3. 接入 cockpit 与 segment APIs。
- 前置依赖：T14、T15
- 是否可并发（是/否）：是
- 并发分组编号：P-05
- 验收标准：打开项目后可直接完成“选区段 -> 生成草稿 -> 编辑”。
- 建议负责人角色：Desktop 前端工程师（UX）

### - [ ] T17 Desktop 高级页面降级为“增强模式”
- 任务名称：Desktop 高级页面降级为“增强模式”
- 目标说明：保留原页面能力，但不再强迫用户走表单流程。
- 涉及范围（文件、目录、模块、服务）：`lisan-desktop/src/pages/ScenesPage.tsx`、`OutlinePage.tsx`、`WorkflowsPage.tsx`、`ChaptersPage.tsx`、`components/SceneEditForm.tsx`
- 执行动作：
1. 增加“高级模式”开关与提示文案。
2. 弱化强 schema 必填，改为建议字段。
3. 与 WriterPage 的草稿状态同步。
- 前置依赖：T16
- 是否可并发（是/否）：否
- 并发分组编号：S-05
- 验收标准：不使用高级模式也能完成主写作流程；旧能力仍可访问。
- 建议负责人角色：Desktop 前端工程师（Legacy Compatibility）

### - [ ] T18 VSCode 插件工程搭建
- 任务名称：VSCode 插件工程搭建
- 目标说明：建立新的主创作入口。
- 涉及范围（文件、目录、模块、服务）：新增 `packages/vscode-extension/*`，修改 `pnpm-workspace.yaml`、根 `package.json`
- 执行动作：
1. 初始化 extension package、命令注册、配置项。
2. 接入 `packages/app-client`。
3. 增加本地调试与打包脚本。
- 前置依赖：T15
- 是否可并发（是/否）：是
- 并发分组编号：P-05
- 验收标准：可在 VSCode 启动扩展并成功连接本地项目。
- 建议负责人角色：VSCode 插件工程师

### - [ ] T19 VSCode 区段生成与驾驶舱编辑能力
- 任务名称：VSCode 区段生成与驾驶舱编辑能力
- 目标说明：让作者在编辑器内完成主流程，不跳桌面端。
- 涉及范围（文件、目录、模块、服务）：`packages/vscode-extension/src/extension.ts`、`src/commands/*`、`src/webview/*`
- 执行动作：
1. 提供区段选择器、生成/重生成命令。
2. 提供 cockpit 快速查看与建议应用。
3. 支持草稿 diff 预览与确认写回。
- 前置依赖：T18、T14、T15
- 是否可并发（是/否）：是
- 并发分组编号：P-06
- 验收标准：单端（VSCode）可闭环完成“选区段 -> 生成 -> 改稿 -> 再生成”。
- 建议负责人角色：VSCode 插件工程师 + 前端工程师（Webview）

### - [ ] T20 双端编辑冲突与锁策略
- 任务名称：双端编辑冲突与锁策略
- 目标说明：Desktop 与 VSCode 并存阶段避免覆盖写入。
- 涉及范围（文件、目录、模块、服务）：`packages/engine/src/story/*`、`packages/engine/src/sidecar/main.ts`、`lisan-desktop`、`packages/vscode-extension`
- 执行动作：
1. 增加乐观锁版本号（基于 revisionId/hash）。
2. 冲突时返回可读错误与三路合并建议。
3. 增加“只读观察模式”防止误改。
- 前置依赖：T16、T19
- 是否可并发（是/否）：是
- 并发分组编号：P-06
- 验收标准：并发编辑不出现静默覆盖；冲突可恢复。
- 建议负责人角色：平台工程师（Concurrency Control）

### 阶段 D：脚本、测试、文档、发布

### - [ ] T21 CLI 与迁移脚本改造
- 任务名称：CLI 与迁移脚本改造
- 目标说明：支持命令行场景下的新工作方式与存量项目迁移。
- 涉及范围（文件、目录、模块、服务）：`packages/cli/src/index.ts`、`packages/cli/src/commands/*`、新增 `scripts/migrations/*`
- 执行动作：
1. 新增命令：`segment:list`、`segment:generate`、`segment:regenerate`、`cockpit:sync`。
2. 提供 `project:migrate-human-first` 一键迁移脚本。
3. 提供 dry-run 与回滚选项。
- 前置依赖：T13、T11
- 是否可并发（是/否）：是
- 并发分组编号：P-05
- 验收标准：CLI 可完成核心闭环；迁移脚本可重复运行且幂等。
- 建议负责人角色：CLI/Tooling 工程师

### - [ ] T22 自动化测试矩阵补齐
- 任务名称：自动化测试矩阵补齐
- 目标说明：建立新模型端到端可回归能力。
- 涉及范围（文件、目录、模块、服务）：`packages/engine/src/**/*.test.ts`、`lisan-desktop/src/**/*.test.tsx`、`packages/vscode-extension/test/*`、根 `vitest.config.ts`
- 执行动作：
1. 增加 cockpit/segment/draft/diff/revision 单元测试。
2. 增加 sidecar RPC 集成测试与迁移回归测试。
3. 增加 VSCode 插件命令流与 webview 交互测试。
- 前置依赖：T19、T20、T21
- 是否可并发（是/否）：是
- 并发分组编号：P-07
- 验收标准：CI 可稳定跑完核心测试套件，关键路径均有自动化覆盖。
- 建议负责人角色：QA 自动化工程师

### - [ ] T23 文档体系重写（开发/运维/迁移）
- 任务名称：文档体系重写（开发/运维/迁移）
- 目标说明：让新老团队按文档独立上手与发布。
- 涉及范围（文件、目录、模块、服务）：`README.md`、`ARCHITECTURE.md`、`docs/CODE_REFERENCE.md`、`docs/INTERFACE_CATALOG.md`、`docs/RPC_REFERENCE.md`、`docs/OPERATION_MANUAL.md`、新增 `docs/MIGRATION_GUIDE.md`
- 执行动作：
1. 更新写作主流程为“区段生成 + 草稿打磨 + 可选润色”。
2. 更新接口目录与 RPC 参考。
3. 新增从旧项目升级到新协议的迁移文档。
- 前置依赖：T13、T16、T19、T21
- 是否可并发（是/否）：是
- 并发分组编号：P-07
- 验收标准：新成员仅看文档即可完成本地运行、迁移、排障。
- 建议负责人角色：技术文档工程师 + 研发代表

### - [ ] T24 CI/CD 与发布产物准备
- 任务名称：CI/CD 与发布产物准备
- 目标说明：打通双端（Desktop + VSCode）的构建、测试、打包和发布流程。
- 涉及范围（文件、目录、模块、服务）：根 `package.json`、`pnpm-workspace.yaml`、新增 `.github/workflows/*`、`lisan-desktop/package.json`、`packages/vscode-extension/package.json`
- 执行动作：
1. 增加 workspace 任务：build/test/typecheck for extension。
2. 增加 CI 流水线（引擎、桌面端、扩展分层执行）。
3. 增加发布脚本（Desktop artifact + VSIX 包）。
- 前置依赖：T22、T23
- 是否可并发（是/否）：否
- 并发分组编号：S-06
- 验收标准：主分支合并后可自动产出可安装包与发布说明。
- 建议负责人角色：DevOps/Release 工程师

### - [ ] T25 灰度发布与回滚演练
- 任务名称：灰度发布与回滚演练
- 目标说明：验证真实项目迁移成功率和故障恢复能力。
- 涉及范围（文件、目录、模块、服务）：`test-project/`、真实样本项目（脱敏）、发布脚本、迁移脚本
- 执行动作：
1. 选择样本项目执行全量迁移与回写验证。
2. 演练失败注入（迁移中断、冲突写入、接口降级）。
3. 输出回滚操作手册和故障判定阈值。
- 前置依赖：T24
- 是否可并发（是/否）：否
- 并发分组编号：S-07
- 验收标准：灰度项目可在 SLA 内恢复；回滚步骤可重复执行。
- 建议负责人角色：发布经理 + QA + Tech Lead

### - [ ] T26 终验收与交付封板
- 任务名称：终验收与交付封板
- 目标说明：形成可执行、可运维、可持续迭代的最终交付。
- 涉及范围（文件、目录、模块、服务）：全仓库 + 发布制品 + 迁移报告
- 执行动作：
1. 按验收清单逐条验收并记录证据。
2. 锁定版本号、发布说明、已知问题清单。
3. 向 agent team 输出下一阶段 backlog（优化项）。
- 前置依赖：T25
- 是否可并发（是/否）：否
- 并发分组编号：S-08
- 验收标准：产品、研发、QA、运维四方签字通过。
- 建议负责人角色：项目经理（Delivery Lead）

---

## 并发/串行说明

### 可并发执行任务
- 并发分组 P-01：T04、T05、T06
- 并发分组 P-02：T07、T08、T09、T10
- 并发分组 P-03：T12、T13
- 并发分组 P-04：T14、T15
- 并发分组 P-05：T16、T18、T21
- 并发分组 P-06：T19、T20
- 并发分组 P-07：T22、T23

### 必须串行执行任务
- S-01：T01
- S-02：T02
- S-03：T03
- S-04：T11
- S-05：T17
- S-06：T24
- S-07：T25
- S-08：T26

### 串行任务依赖链路（主链）

`T01 -> T02 -> T03 -> (P-01 + P-02) -> T11 -> (P-03 + P-04) -> (P-05 + P-06) -> (P-07) -> T24 -> T25 -> T26`

---

## 理论可并发但存在冲突/联调风险（需单独管控）

| 风险编号 | 涉及任务 | 冲突类型 | 风险说明 | 管控措施 |
|---|---|---|---|---|
| R-01 | T04 vs T11 | 文件冲突 | 都会修改 `packages/engine/src/types.ts` 与 `store/database.ts` 的关联结构 | 先合并 T04 类型基线，再由 T11 分支 rebase；每日 schema diff 审查 |
| R-02 | T13 vs T14 | 接口漂移 | RPC 与 Tauri Command 并行修改，易出现方法名不一致 | 统一 `packages/app-client` 作为契约源；联调前跑 contract test |
| R-03 | T16 vs T17 | 路由冲突 | Desktop 导航改造与旧页面降级会同时修改 `App.tsx/ProjectLayout.tsx` | 先落地 T16 路由骨架，再在 T17 上增量改造 |
| R-04 | T18 vs T19 | 目录冲突 | VSCode 扩展骨架与功能实现都在同一目录，易覆盖 | T18 完成后锁定目录结构与命令命名，T19 仅增量提交 |
| R-05 | T20 vs T21 | 联调风险 | 冲突锁策略与迁移脚本并行会影响回放结果 | 联调窗口内冻结迁移脚本接口，先完成锁策略后再跑迁移演练 |
| R-06 | T22 vs T24 | 发布风险 | 测试矩阵未稳定就接入 CI，会导致流水线噪音 | 先完成核心测试分层，再切换 CI 为强校验 |

---

## 验收与交付清单

### 功能验收
- [ ] 可维护 `故事驾驶舱/story-cockpit.md`，作者手改后系统可正确吸收。
- [ ] 支持按大纲区段选择生成与重生成，不触发全量重写。
- [ ] 默认输出无修辞场景草稿；润色为可选后置能力。
- [ ] 用户改稿后，AI 能基于 diff 自动调整后续生成上下文。
- [ ] 路人/配角生成具备剧情功能解释，不是随机补全。

### 工程验收
- [ ] 新旧数据库均可升级，迁移可回滚。
- [ ] Sidecar RPC、Tauri Command、SDK 类型完全对齐。
- [ ] Desktop 与 VSCode 双端可运行且不发生静默覆盖。
- [ ] 测试矩阵通过（单元/集成/E2E/迁移回归）。
- [ ] CI 可稳定产出 Desktop 与 VSIX 发布物。

### 文档与发布验收
- [ ] 架构、接口、运维、迁移文档全部更新并互相引用。
- [ ] 发布说明包含已知限制、升级路径、回滚路径。
- [ ] 灰度报告包含故障注入结果与恢复时长。
- [ ] 交付包包含：实施记录、迁移记录、验收证据、下一阶段 backlog。

---

## 给 Agent Team 的执行建议

1. 严格按任务 ID 建立分支与 PR（一个任务一个 PR）。
2. 每个并发分组指定 1 名分组 Owner 负责冲突协调。
3. 每日固定一次“契约同步会”（类型、RPC、迁移脚本）。
4. 串行关卡（T11/T24/T25/T26）必须由 Tech Lead 做 gate review。
5. 未通过验收标准前，不得进入下一个串行关卡。
