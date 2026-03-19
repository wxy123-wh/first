## ADDED Requirements

### Requirement: 项目状态持久化
系统 SHALL 将项目状态持久化到 `state.json`，支持加载、保存和章节记录更新。

#### Scenario: 加载项目状态
- **WHEN** 调用 `stateManager.load()`
- **THEN** 返回 `ProjectState`，包含当前章节号、弧线、所有章节记录

#### Scenario: 更新章节状态
- **WHEN** 调用 `stateManager.updateChapter(5, { status: "done", wordCount: 3800 })`
- **THEN** `state.json` 中第5章记录更新，`lastUpdated` 刷新为当前时间

### Requirement: 实体图谱（SQLite）
系统 SHALL 使用 SQLite 存储实体图谱，支持角色、地点、物品、事件的增删查。

#### Scenario: 写入新角色
- **WHEN** Data Agent 提取到新角色实体
- **THEN** 角色信息写入 SQLite `entities` 表，包含 id、name、type、metadata、createdInChapter

#### Scenario: 查询弧线内角色
- **WHEN** Context Agent 检索当前弧线的已有配角
- **THEN** 返回 `persistence` 为 `arc` 或 `permanent` 且 `arcId` 匹配的角色列表

### Requirement: 自动 Git commit
系统 SHALL 在每章完成后自动执行 git commit，commit message 包含章节号和标题。

#### Scenario: 章节完成自动提交
- **WHEN** write 管线 Step 6 执行
- **THEN** 执行 `git add` + `git commit -m "第XXXX章: {title}"`，`ChapterRecord.gitCommit` 记录 commit hash

#### Scenario: --no-git 跳过提交
- **WHEN** 命令行传入 `--no-git`
- **THEN** 跳过 git commit，其他步骤正常执行

### Requirement: schema 版本迁移
系统 SHALL 在 `state.json` 中记录 schema 版本，加载时检测版本并执行迁移。

#### Scenario: 旧版本 state 迁移
- **WHEN** `state.json` 的 `version` 低于当前 schema 版本
- **THEN** 自动执行迁移脚本，升级到当前版本后继续运行
