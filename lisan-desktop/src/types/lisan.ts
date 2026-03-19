// Lisan 数据类型定义

export interface Project {
  id: string;
  name: string;
  path: string;
  lastExecutionTime?: string;
  chapterCount: number;
  status: 'idle' | 'running' | 'completed' | 'error';
}

export interface Execution {
  id: string;
  projectId: string;
  timestamp: string;
  pipelineType: 'write' | 'rewrite' | 'plan' | 'decompose';
  chapterNumber?: number;
  status: 'running' | 'completed' | 'error';
  duration?: number;
}

export interface ExecutionDetail {
  id: string;
  execution: Execution;
  stages: PipelineStage[];
}

export interface PipelineStage {
  name: string;
  type: 'context' | 'draft' | 'pass' | 'review' | 'data';
  status: 'pending' | 'running' | 'completed' | 'error';
  startTime?: string;
  endTime?: string;
  agents: AgentExecution[];
}

export interface AgentExecution {
  name: string;
  role: string;
  input: {
    prompt: string;
    context?: Record<string, unknown>;
  };
  output: {
    content: string;
    tokens?: TokenStats;
  };
  duration: number;
  status: 'completed' | 'error';
  error?: string;
}

export interface TokenStats {
  input: number;
  output: number;
  total: number;
}

export interface PassExecution {
  passNumber: number;
  name: string;
  input: string;
  output: string;
  diff?: string;
  tokens: TokenStats;
  duration: number;
}

// JSONL 追踪日志格式
export interface TraceLogEntry {
  timestamp: string;
  level: 'info' | 'error' | 'debug';
  stage: string;
  agent?: string;
  event: string;
  data?: Record<string, unknown>;
}
