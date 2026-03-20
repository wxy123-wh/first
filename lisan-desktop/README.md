# lisan-desktop 模块说明

`lisan-desktop` 是 Lisan 的桌面端应用，技术栈为 **Tauri 2 + React 19 + Vite 7 + TypeScript**。

## 目录职责

- `src/pages`：业务页面（项目、纲要、场景、章节、工作流、智能体、Provider、执行、设置）
- `src/layouts`：项目级布局与导航
- `src/hooks/useSidecar.ts`：前端到 Tauri command 的统一调用入口
- `src/hooks/useWorkflowEvents.ts`：订阅 sidecar 实时事件
- `src/lib/store.ts`：全局状态管理（项目上下文、sidecar 状态、工作流事件）
- `src/types/engine.ts`：前端主数据结构定义
- `src-tauri/src`：Rust 层 command + sidecar 管理

## 关键行为

- 页面不直接访问数据库，统一走 `useSidecar()`
- 项目打开后，布局层会触发 `project_open`，并初始化 sidecar 连接状态
- 执行详情页实时消费 `workflow:*` 与 `step:*` 事件并更新 UI
- 工作流编辑器支持拖拽排序，保存后以步骤顺序回写后端

## 开发提示

- 修改 `packages/engine/src/sidecar/main.ts` 或运行时逻辑后，必须先重建 engine：
  - `pnpm --filter @lisan/engine build`
- 否则桌面端会收到 sidecar 构建一致性错误。
