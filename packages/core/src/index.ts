// @lisan/core — 核心引擎

// 错误
export { LisanError, LisanErrorCode } from './errors/index.js';

// 状态管理
export type { ChapterRecord, ProjectState, StateManager } from './state/types.js';
export { FileStateManager, registerMigration } from './state/file-state-manager.js';
export type { Entity, EntityGraph } from './state/entity-graph.js';
export { SqliteEntityGraph } from './state/entity-graph.js';

// Agent
export type { AgentDefinition, AgentInput, AgentOutput, Agent } from './agent/types.js';
export { AgentExecutor } from './agent/executor.js';

// 管线
export type {
  PipelineId,
  PipelineContext,
  PipelineError,
  PipelineResult,
  Pipeline,
  PassDefinition,
  PassInput,
  PassOutput,
  Pass,
} from './pipeline/types.js';
export { PassRunner } from './pipeline/pass-runner.js';
export { preflightCheck, type PreflightResult } from './pipeline/preflight.js';
export { ModelRouter, type ModelRouterConfig } from './pipeline/model-router.js';
export { DecomposePipeline, type DecomposePipelineDeps } from './pipeline/decompose-pipeline.js';
export { PlanPipeline, type PlanPipelineDeps } from './pipeline/plan-pipeline.js';
export { WritePipeline, type WritePipelineDeps } from './pipeline/write-pipeline.js';
export { RewritePipeline, type RewritePipelineDeps } from './pipeline/rewrite-pipeline.js';

// Context
export type {
  SceneDefinition,
  GeneratedCharacter,
  ContextPack,
} from './context/types.js';
export { ContextAgent, type ContextAgentDeps } from './context/context-agent.js';

// 插件
export type { BookConfig, LisanPlugin } from './plugin/types.js';
export { loadPlugin } from './plugin/loader.js';

// 可观测性
export type { TraceEvent, TraceEventType } from './observability/types.js';
export { TraceWriter } from './observability/trace-writer.js';

// 确定性后验证器
export { checkDraft, type CheckResult, type CheckViolation } from './checker/index.js';

// 真相文件体系
export type {
  TruthFiles,
  SettlementData,
  CharacterInteraction,
  HookChange,
  WorldStateChange,
  UpgradeEvent,
} from './truth/index.js';
export {
  TruthManager,
  CURRENT_STATE_TEMPLATE,
  PENDING_HOOKS_TEMPLATE,
  CHARACTER_MATRIX_TEMPLATE,
} from './truth/index.js';
