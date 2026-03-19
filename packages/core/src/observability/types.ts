// 可观测性接口定义

/** 追踪事件类型 */
export type TraceEventType =
  | 'pipeline_start'
  | 'pipeline_end'
  | 'agent_start'
  | 'agent_end'
  | 'pass_start'
  | 'pass_end'
  | 'checker_end'
  | 'rag_query'
  | 'error';

/** 追踪事件 */
export interface TraceEvent {
  timestamp: string;
  traceId: string;
  event: TraceEventType;
  payload: Record<string, unknown>;
}
