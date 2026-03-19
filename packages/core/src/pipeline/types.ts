// 管线接口定义

import type { AgentOutput } from '../agent/types.js';
import type { ContextPack } from '../context/types.js';
import type { BookConfig } from '../plugin/types.js';

/** 管线 ID */
export type PipelineId = 'decompose' | 'plan' | 'write' | 'rewrite';

/** 管线上下文 */
export interface PipelineContext {
  projectRoot: string;
  bookConfig: BookConfig;
  chapterNumber?: number;
  arcId?: string;
}

/** 管线错误 */
export interface PipelineError {
  step: string;
  message: string;
  code?: string;
}

/** 管线结果 */
export interface PipelineResult {
  success: boolean;
  outputs: Record<string, string>;
  errors?: PipelineError[];
  stats: {
    durationMs: number;
    totalTokens: number;
    totalCostUsd?: number;
  };
}

/** 管线接口 */
export interface Pipeline {
  readonly id: PipelineId;
  run(ctx: PipelineContext): Promise<PipelineResult>;
}

/** Pass 定义 */
export interface PassDefinition {
  id: string;
  name: string;
  agentId: string;
  order: number;
}

/** Pass 输入 */
export interface PassInput {
  draft: string;
  contextPack: ContextPack;
  chapterNumber: number;
  /** 确定性检查器违规清单摘要，非空时注入 Pass prompt */
  checkerSummary?: string;
}

/** Pass 输出 */
export interface PassOutput {
  revised: string;
  notes?: string;
  agentOutput: AgentOutput;
}

/** Pass 接口 */
export interface Pass {
  readonly definition: PassDefinition;
  execute(input: PassInput): Promise<PassOutput>;
}
