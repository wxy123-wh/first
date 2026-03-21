# RPC / Command 参考

## 1. 调用链

前端调用顺序：
1. `useSidecar()` -> `invoke(command, payload)`
2. Rust command（`src-tauri/src/commands/*.rs`）
3. `SidecarManager.call / call_with_fallback`
4. sidecar JSON-RPC（`packages/engine/src/sidecar/main.ts`）
5. Engine 模块执行后返回

## 2. Tauri Command 到 RPC 映射

| Tauri command | 首选 RPC | 回退 RPC | 说明 |
|---|---|---|---|
| `project_open` | `project.open` | - | 打开项目并确保 sidecar 已启动 |
| `project_get` | `project.get` | - | 读取项目 |
| `project_update` | `project.update` | - | 更新项目（标签模板等） |
| `outline_get` | `outline.get` | - | 读取大纲 |
| `outline_save` | `outline.save` | - | 保存大纲 |
| `workflow_list` | `workflow.list` | - | 列工作流（并补默认流） |
| `workflow_save` | `workflow.save` | - | 保存工作流 |
| `workflow_run` | `workflow.run` | `workflow.rerun` | 运行工作流 |
| `workflow_pause` | `workflow.pause` | - | 暂停执行 |
| `workflow_resume` | `workflow.resume` | - | 恢复执行 |
| `workflow_skip` | `workflow.skip` | - | 跳过步骤（运行中当前步骤会触发中断并标记 `skipped`） |
| `workflow_rerun` | `workflow.rerun` | `workflow.run` | 重跑工作流 |
| `workflow_abort` | `workflow.abort` | - | 终止执行（运行中当前步骤会被中断） |
| `agent_list` | `agent.list` | - | 智能体列表 |
| `agent_save` | `agent.save` | `agent.update` / `agent.register` | 兼容旧 sidecar |
| `agent_delete` | `agent.delete` | - | 删除自定义智能体 |
| `agent_get_md` | `agent.getMd` | - | 读取 agent.md |
| `agent_save_md` | `agent.saveMd` | - | 保存 agent.md |
| `provider_list` | `provider.list` | - | Provider 列表（失败可回退默认列表） |
| `provider_save` | `provider.save` | - | 保存 Provider |
| `provider_delete` | `provider.delete` | - | 删除 Provider |
| `scene_list` | `scene.list` | - | 场景列表 |
| `scene_save` | `scene.save` | - | 保存场景 |
| `scene_delete` | `scene.delete` | - | 删除场景 |
| `scene_reorder` | `scene.reorder` | - | 场景排序 |
| `chapter_list` | `chapter.list` | - | 章节列表 |
| `chapter_get_content` | `chapter.getContent` | - | 读取章节正文 |
| `chapter_save` | `chapter.save` | `chapter.create` | 保存章节 |
| `chapter_create` | `chapter.create` | `chapter.save` | 创建章节 |
| `chapter_save_content` | `chapter.saveContent` | - | 保存正文 |
| `execution_list` | `execution.list` | - | 执行列表 |
| `execution_detail` | `execution.detail` | `execution.get` | 执行详情 |

### 2.1 关键接口参数（当前主链路）

#### `workflow.run`

- 入口：Tauri `workflow_run` -> RPC `workflow.run`（fallback `workflow.rerun`）
- 参数：
  - `workflowId: string`（必填）
  - `chapterId?: string`
  - `globalContext?: object`（未传时 Rust 层补 `{}`）
- 返回：`{ started: true }`
- 行为：异步启动；执行进度通过 `workflow:*` / `step:*` 事件回推
- 常见异常：
  - sidecar 不支持方法：`RPC error -32601`（Rust 层会归一化提示“请重建 @lisan/engine sidecar”）
  - 运行时异常：通过 `workflow:error` 通知回传

#### `workflow.skip`

- 入口：Tauri `workflow_skip` -> RPC `workflow.skip`
- 参数：
  - `executionId: string`
  - `stepId: string`
- 返回：`null`
- 行为：
  - 若目标步骤正运行：触发当前步骤 `AbortController.abort()`，步骤状态落为 `skipped`
  - 若目标步骤尚未开始：进入预跳过队列，执行到该步骤时直接记 `skipped`

#### `workflow.abort`

- 入口：Tauri `workflow_abort` -> RPC `workflow.abort`
- 参数：`executionId: string`
- 返回：`null`
- 行为：中断当前步骤并停止后续步骤，execution 最终状态为 `failed`

#### `chapter.save` / `chapter.getContent` / `chapter.saveContent`

- `chapter.save`：
  - 入口：Tauri `chapter_save` -> RPC `chapter.save`（fallback `chapter.create`）
  - 参数：`chapter: Chapter`
  - 返回：保存后的 `Chapter`
- `chapter.getContent`：
  - 参数：`id: string`
  - 返回：章节正文字符串
- `chapter.saveContent`：
  - 参数：`id: string`, `content: string`
  - 返回：`null`
  - 说明：章节工作流完成后，runtime 会调用同名存储能力完成正文自动回写（对前端表现为内容已更新）

## 3. 本地 command（不经过 sidecar）

| Command | 文件 | 说明 |
|---|---|---|
| `list_projects` | `commands/projects.rs` | 扫描 `workspace_root` 下项目目录 |
| `create_project` | `commands/projects.rs` | 创建目录、配置、示例大纲 |
| `delete_project` | `commands/projects.rs` | 删除 `.lisan` 子目录 |

## 4. 事件与通知

### 4.1 sidecar 进程事件（Rust 发给前端）

- `sidecar:started`
- `sidecar:exit`
- `sidecar:error`
- `sidecar:stderr`
- `sidecar:notification`

### 4.2 workflow 运行事件（sidecar JSON-RPC 通知）

- `workflow:start`
- `step:start`
- `step:progress`
- `step:complete`
- `step:skipped`
- `step:failed`
- `workflow:complete`
- `workflow:error`

前端通过 `useWorkflowEvents()` 订阅并缓存到 `useAppStore().workflowEvents`。

## 5. 兼容与容错要点

- 方法不存在：优先走 fallback 方法名（`call_with_fallback`）
- 请求超时：`REQUEST_TIMEOUT = 120s`
- sidecar 异常退出：自动重启（延迟 1 秒）
- sidecar 构建过旧：会阻止启动并提示先重建 `@lisan/engine`

## 6. 错误码与鉴权

- JSON-RPC 错误码（`packages/engine/src/sidecar/rpc-server.ts`）：
  - `-32700`：Parse error
  - `-32600`：Invalid Request
  - `-32601`：Method not found
  - `-32603`：Internal error
- 鉴权：当前链路为本地进程内调用（React -> Tauri -> 本地 sidecar），无独立 Token/Session 鉴权层。

## 7. 调用示例（前端）

```ts
await invoke("workflow_run", {
  workflowId: "wf_chapter_default",
  chapterId: "chapter_001",
  globalContext: { sourceOutline: "..." },
});

await invoke("workflow_skip", {
  executionId: "exec_123",
  stepId: "step_01",
});

await invoke("chapter_save_content", {
  id: "chapter_001",
  content: "# 第1章 ...",
});
```
