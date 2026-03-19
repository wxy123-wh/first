## ADDED Requirements

### Requirement: 场景驱动的执行包生成
系统 SHALL 由 Context Agent 读取 chapter-plan.md 和 scenes.md，组装完整的 `ContextPack` 作为起草输入。

#### Scenario: 生成执行包
- **WHEN** 调用 Context Agent，传入章节号
- **THEN** 输出包含场景蓝图、上章衔接、设定参考、角色卡的完整执行包，写入 `.lisan/tmp/context_pack_chXXXX.md`

### Requirement: 自主创角判断
系统 SHALL 允许 Context Agent 根据场景情境自主创建大纲未提及的配角或路人，不受大纲角色列表约束。

#### Scenario: 场景需要施压角色
- **WHEN** 场景情绪任务为"压制"，但大纲未指定施压者
- **THEN** Context Agent 自主创建一个配角（含姓名/外貌/身份/说话风格），写入 `.lisan/tmp/new_chars_chXXXX.md`

#### Scenario: SceneDefinition 禁用自主创角
- **WHEN** `SceneDefinition.allowNewCharacters === false`
- **THEN** Context Agent 不创建新角色，只使用大纲指定角色

### Requirement: 自主创角持久化策略
系统 SHALL 按 `GeneratedCharacter.persistence` 决定角色的生命周期。

#### Scenario: chapter 级角色
- **WHEN** `persistence === "chapter"`
- **THEN** 角色只存在于本章临时文件，不写入实体图谱

#### Scenario: arc 级角色
- **WHEN** `persistence === "arc"`
- **THEN** 角色写入实体图谱，标记为次要角色，弧线内后续章节可检索复用

#### Scenario: permanent 级角色
- **WHEN** `persistence === "permanent"`
- **THEN** 角色写入实体图谱，标记 `needsReview: true`，`status` 命令展示待审查列表

### Requirement: 三层渐进式设定检索
Context Agent SHALL 按 L0→L1→L2 顺序读取设定，确认需要后才读全文。

#### Scenario: L0 判断后跳过
- **WHEN** L0 摘要显示该设定与本章无关
- **THEN** 不读取 L1/L2，节省 token

#### Scenario: L2 按需读取
- **WHEN** L1 概览显示需要完整设定内容
- **THEN** 读取 L2 全文并纳入执行包的 `settingRefs`
