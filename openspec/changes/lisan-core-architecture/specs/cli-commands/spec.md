## ADDED Requirements

### Requirement: 四条管线子命令
系统 SHALL 提供 `decompose`、`plan`、`write`、`rewrite` 四个 CLI 子命令。

#### Scenario: 写作单章
- **WHEN** 执行 `lisan write 5`
- **THEN** 触发 write 管线，处理第5章，输出正文到 `正文/第X卷/第0005章.md`

#### Scenario: 批量写作
- **WHEN** 执行 `lisan write --batch 1-10`
- **THEN** 串行执行第1到第10章的 write 管线，每章完成后自动 git commit

### Requirement: --dry-run 模式
系统 SHALL 支持 `--dry-run` 选项，只生成执行包，不调用 LLM。

#### Scenario: dry-run 执行
- **WHEN** 执行 `lisan write 5 --dry-run`
- **THEN** 生成 `context_pack_ch0005.md`，打印执行计划，不发起任何 LLM 调用

### Requirement: 项目初始化
系统 SHALL 提供 `lisan init [dir]` 命令，创建标准项目目录结构和配置文件。

#### Scenario: 初始化新项目
- **WHEN** 执行 `lisan init my-novel`
- **THEN** 创建 `my-novel/` 目录，包含 `lisan.config.yaml`、`大纲/`、`设定集/`、`场景树/`、`正文/`、`.lisan/` 标准结构

### Requirement: status 命令
系统 SHALL 提供 `lisan status` 命令，展示项目进度、待审查角色列表和成本统计。

#### Scenario: 查看项目进度
- **WHEN** 执行 `lisan status`
- **THEN** 输出各章节状态（pending/drafting/done）、总字数、总 token 消耗和估算成本

### Requirement: --project 选项
系统 SHALL 支持 `--project/-p` 选项指定项目根目录，默认为当前目录。

#### Scenario: 指定项目目录
- **WHEN** 执行 `lisan write 5 -p /path/to/novel`
- **THEN** 所有文件读写操作基于 `/path/to/novel` 目录
