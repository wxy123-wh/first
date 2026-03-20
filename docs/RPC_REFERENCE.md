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
| `workflow_skip` | `workflow.skip` | - | 跳过步骤 |
| `workflow_rerun` | `workflow.rerun` | `workflow.run` | 重跑工作流 |
| `workflow_abort` | `workflow.abort` | - | 终止执行 |
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
- `step:failed`
- `workflow:complete`

前端通过 `useWorkflowEvents()` 订阅并缓存到 `useAppStore().workflowEvents`。

## 5. 兼容与容错要点

- 方法不存在：优先走 fallback 方法名（`call_with_fallback`）
- 请求超时：`REQUEST_TIMEOUT = 120s`
- sidecar 异常退出：自动重启（延迟 1 秒）
- sidecar 构建过旧：会阻止启动并提示先重建 `@lisan/engine`
