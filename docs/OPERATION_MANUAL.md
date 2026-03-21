# 操作手册

## 1. 环境要求

- Node.js: `>=22`（仓库 `package.json`）
- pnpm: `9.15.4`
- Rust 工具链（Tauri 构建需要）
- Windows/macOS/Linux 的 Tauri 运行依赖（按 Tauri 官方安装）

## 2. 仓库安装

### 2.1 安装根仓库依赖

```bash
pnpm install
```

### 2.2 安装桌面端依赖

`lisan-desktop` 当前独立使用 npm：

```bash
cd lisan-desktop
npm install
cd ..
```

## 3. 常用命令

### 3.1 根仓库

```bash
pnpm build
pnpm test
pnpm typecheck
```

### 3.2 Engine（sidecar）

```bash
pnpm --filter @lisan/engine build
pnpm --filter @lisan/engine test
```

### 3.3 Desktop

```bash
cd lisan-desktop
npm run dev
npm run tauri dev
npm run build
```

## 4. 日常开发流程（推荐）

1. 拉取代码后先执行：`pnpm install` + `cd lisan-desktop && npm install`
2. 修改 `packages/engine` 后先重建：`pnpm --filter @lisan/engine build`
3. 启动桌面端：`cd lisan-desktop && npm run tauri dev`
4. 在桌面端创建项目时，可直接设置 `orchestrator/worker` 的 provider 与 model
5. 创建后首次打开项目时，`llmConfig` 会自动引导到 Provider 默认模型；在 Provider 页面补齐 API Key
6. 在大纲页或场景页执行“场景拆解”时，可选择“不绑定章节”或“绑定到章节”
7. 在场景页可按筛选范围执行“批量绑定/批量解绑”章节
8. 在工作流/智能体页面调整流程
9. 在章节页切换 workflow 时会立即持久化到 `chapter.workflowId`
10. 在章节页运行工作流并在执行页观察实时状态；必要时在章节页执行“删除章节”（会解绑关联场景与执行）
11. 在“设定集”页面维护设定文档，在设置页进入 RAG 同步页执行/重试同步
12. 执行详情默认不展示内部 ID；如需排障可切换“诊断视图”查看 `executionId/stepId`

### 4.1 主链路行为（当前版本）

- 章节工作流执行成功后，系统会自动回写章节正文文件。
- 若正文回写失败，execution 会标记为 `failed`，不会出现“completed 但正文未更新”的假成功。
- 新建项目时填写的 `llmConfig` 会写入项目配置，并在首次 engine 初始化时引导 Provider 默认模型。
- 章节页切换 workflow 下拉后会立即保存；刷新页面后保持章节绑定的 workflow 选择。
- 首页项目卡片的 `章节数/最近执行时间/状态` 来自 `.lisan/lisan.db` 聚合，状态统一为 `idle/running/completed/failed`。
- 在执行详情页点击“跳过当前步骤”时，运行中的步骤会被中断并标记 `skipped`。
- 在执行详情页点击“终止”时，运行中的步骤会被中断，后续步骤不再继续。
- 场景拆解输出缺失 `chapterId` 时，会按入口章节兜底绑定；场景页支持按筛选范围批量绑定与批量解绑章节。
- 场景输出支持 `object.scenes`、数组根节点与 JSON fenced block；解析失败时会尝试一次自动修复。
- 若场景工作流需要场景产出但最终 0 条落库，execution 会标记 `failed` 并在摘要给出失败原因。
- 章节删除使用 `detach` 策略：删除章节同时解绑关联场景与执行记录，不自动重排章节编号。
- 设定集支持持久化到 `设定集/` 目录，并由 SQLite 维护索引；文件改动会在读取时回写索引。
- RAG 页面已支持执行同步、查看进度与失败明细；同步状态支持重试。

## 5. 项目数据目录

以 `<project-root>` 表示用户项目目录：

- `<project-root>/大纲/arc-1.md`：主大纲
- `<project-root>/设定集/**/*.md`：设定集文档（文件为源）
- `<project-root>/chapters/*.md`：章节正文（当前章节页默认路径）
- `<project-root>/truth/*.md`：真相文件
- `<project-root>/.lisan/lisan.db`：主数据库
- `<project-root>/.lisan/provider-api-key.key`：本地加密密钥
- `<project-root>/.lisan/agents/**`：智能体 Markdown
- `<project-root>/.lisan/vectors/**`：RAG 向量库目录
- `<project-root>/.lisan/traces/*.jsonl`：兼容保留追踪日志（首页统计已改为 DB 聚合，不再以该目录为准）

RAG 同步默认扫描目录：`设定集/`、`大纲/`、`场景树/`、`正文/`、`chapters/`（目录不存在时自动跳过）。

## 6. 环境变量

### 6.1 Workspace 与 sidecar

- `LISAN_WORKSPACE_ROOT`：桌面端项目扫描根目录
- `LISAN_NODE_BIN`：指定 sidecar 启动 Node 可执行文件
- `LISAN_ENGINE_SIDECAR`：指定 sidecar 脚本路径

### 6.2 Provider API Key（兜底）

- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `NEWAPI_API_KEY`（或 `NEW_API_KEY`）

### 6.3 Provider Base URL（可选）

- `OPENAI_BASE_URL`
- `ANTHROPIC_BASE_URL`
- `NEWAPI_BASE_URL`（或 `NEW_API_BASE_URL`）

## 7. 故障排查

### 7.1 “sidecar is not running, call project_open first”

- 先在 UI 打开项目（触发 `project_open`）
- 确认 `lisan-desktop` 当前项目路径可访问

### 7.2 “Method not found” / workflow.run 不支持

- sidecar 与前端接口版本不一致
- 解决：
  - `pnpm --filter @lisan/engine build`
  - 重启 `npm run tauri dev`

### 7.3 “源码新于 sidecar 构建产物”

- Engine 源码修改后未重建 sidecar
- 解决：`pnpm --filter @lisan/engine build`

### 7.4 Provider 保存后仍调用失败

- 检查 Provider 的 `type/model/baseUrl/apiKey`
- 若数据库里无 key，可临时用环境变量兜底
- 变更 Provider 后建议重跑当前执行

### 7.5 删除 Provider 失败

- 若有 Agent 正在使用该 Provider，删除会被拒绝
- 先在智能体页面切换 Provider，再删除

### 7.6 点击“跳过当前步骤”后未立即变成 skipped

- 运行中步骤会先进入“正在跳过...”，等待模型请求中断后再落为 `skipped`
- 若步骤在中断生效前已完成，页面会提示“当前步骤已完成，跳过请求未生效”

### 7.7 点击“终止”后执行仍短暂显示 running

- `abort` 会先中断当前步骤，再由 `workflow:complete` 收敛最终状态
- 这是异步事件链路的正常表现；以执行详情最终状态为准

### 7.8 场景出现“未绑定章节”

- 到场景页将筛选切到“未绑定章节”确认范围
- 选择目标章节后点击“批量绑定”
- 若需要取消绑定，可在对应筛选范围点击“批量解绑”
- 调整后重新运行章节写作，可让章节上下文稳定拿到场景

### 7.9 RAG 同步失败或无结果

- 若提示“当前 sidecar 不支持 rag.sync/rag.status”，说明 engine 构建产物过旧
- 解决：`pnpm --filter @lisan/engine build` 后重启 `npm run tauri dev`
- 若状态显示“未找到可同步的 Markdown 文件”，检查 `设定集/大纲/场景树/正文/chapters` 目录是否有 `.md` 文件

### 7.10 章节页切换 workflow 后刷新不一致

- 正常情况下切换会立即保存并在刷新后保持一致
- 若出现不一致，先检查是否弹出“保存失败 / Method not found”提示
- 解决：重建 sidecar（`pnpm --filter @lisan/engine build`）并重启 `npm run tauri dev`

### 7.11 sidecar 连续快速退出并停止自动重启

- 若出现“sidecar 连续快速退出，已暂停自动重启”的报错，通常是 `LISAN_NODE_BIN` 指向无效 Node
- 先检查 `LISAN_NODE_BIN`，并在终端手动执行 sidecar 脚本确认可运行
- 修复后重启 `npm run tauri dev`

## 8. 版本与兼容提醒

- `packages/core` / `packages/cli` / `plugins/webnovel` 处于兼容保留状态
- 新功能优先按 `packages/engine + lisan-desktop` 链路实现
