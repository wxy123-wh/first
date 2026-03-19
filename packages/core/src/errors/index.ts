// 错误码枚举

export enum LisanErrorCode {
  // 配置错误
  CONFIG_NOT_FOUND = 'CONFIG_NOT_FOUND',
  CONFIG_INVALID = 'CONFIG_INVALID',
  // 项目结构错误
  PROJECT_NOT_INIT = 'PROJECT_NOT_INIT',
  CHAPTER_PLAN_MISSING = 'CHAPTER_PLAN_MISSING',
  SCENE_TREE_MISSING = 'SCENE_TREE_MISSING',
  // LLM 错误
  LLM_TIMEOUT = 'LLM_TIMEOUT',
  LLM_RATE_LIMIT = 'LLM_RATE_LIMIT',
  LLM_CONTEXT_OVERFLOW = 'LLM_CONTEXT_OVERFLOW',
  // RAG 错误
  VECTOR_STORE_ERROR = 'VECTOR_STORE_ERROR',
  EMBED_ERROR = 'EMBED_ERROR',
  // 管线错误
  PIPELINE_FAILED = 'PIPELINE_FAILED',
  PASS_FAILED = 'PASS_FAILED',
}

/** Lisan 统一错误类 */
export class LisanError extends Error {
  constructor(
    message: string,
    public readonly code: LisanErrorCode,
    public readonly context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'LisanError';
  }
}
