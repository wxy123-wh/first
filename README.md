# Lisan 仓库说明

本仓库已经从早期 CLI 单体阶段演进为 **Engine + Desktop + Sidecar** 的分层架构。

当前文档只保留两类内容：
- 代码说明文档（面向开发者）
- 操作手册（面向使用与运维）

## 文档导航

- `ARCHITECTURE.md`：系统架构总览（当前实现对齐）
- `docs/CODE_REFERENCE.md`：模块说明、功能清单、关键实现点
- `docs/INTERFACE_CATALOG.md`：接口目录（核心 TS/Rust 接口）
- `docs/RPC_REFERENCE.md`：Tauri Command 与 Sidecar JSON-RPC 映射
- `docs/OPERATION_MANUAL.md`：安装、开发、构建、测试、排障手册

## 代码分层（简版）

- `packages/engine`：核心运行时（工作流、执行、存储、sidecar）
- `packages/llm`：LLM Provider 抽象与实现
- `packages/rag`：向量存储与 Embedding
- `lisan-desktop`：Tauri + React 桌面端
- `packages/core` / `packages/cli` / `plugins/webnovel`：保留的兼容层与旧链路
