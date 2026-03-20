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
4. 在桌面端创建或打开项目目录
5. 在 Provider 页面配置 API Key 与模型
6. 在工作流/智能体页面调整流程
7. 在章节页运行工作流并在执行页观察实时状态

## 5. 项目数据目录

以 `<project-root>` 表示用户项目目录：

- `<project-root>/大纲/arc-1.md`：主大纲
- `<project-root>/正文/*.md`：章节正文
- `<project-root>/truth/*.md`：真相文件
- `<project-root>/.lisan/lisan.db`：主数据库
- `<project-root>/.lisan/provider-api-key.key`：本地加密密钥
- `<project-root>/.lisan/agents/**`：智能体 Markdown

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

## 8. 版本与兼容提醒

- `packages/core` / `packages/cli` / `plugins/webnovel` 处于兼容保留状态
- 新功能优先按 `packages/engine + lisan-desktop` 链路实现
