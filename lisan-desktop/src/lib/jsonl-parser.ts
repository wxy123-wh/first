import type { TraceLogEntry, ExecutionDetail, PipelineStage, AgentExecution } from '../types/lisan';

/**
 * 解析 JSONL 追踪日志文件，构建执行详情
 */
export function parseExecutionTrace(jsonlContent: string): ExecutionDetail {
  const lines = jsonlContent.trim().split(/\r?\n/);
  const entries: TraceLogEntry[] = lines.map(line => JSON.parse(line));
  
  const stages: PipelineStage[] = [];
  let currentStage: PipelineStage | null = null;
  let currentAgent: AgentExecution | null = null;
  
  for (const entry of entries) {
    // 检测新的 Stage 开始
    if (entry.event === 'stage_start') {
      if (currentStage) {
        stages.push(currentStage);
      }
      
      currentStage = {
        name: entry.stage,
        type: mapStageType(entry.stage),
        status: 'running',
        startTime: entry.timestamp,
        agents: []
      };
    }
    
    // 检测 Agent 执行
    if (entry.event === 'agent_start' && currentStage) {
      currentAgent = {
        name: entry.agent || 'Unknown',
        role: entry.data?.role as string || '',
        input: {
          prompt: entry.data?.prompt as string || '',
          context: entry.data?.context as Record<string, unknown>
        },
        output: {
          content: '',
          tokens: undefined
        },
        duration: 0,
        status: 'completed'
      };
    }
    
    if (entry.event === 'agent_complete' && currentAgent && currentStage) {
      currentAgent.output.content = entry.data?.output as string || '';
      currentAgent.output.tokens = entry.data?.tokens as any;
      currentAgent.duration = entry.data?.duration as number || 0;
      currentStage.agents.push(currentAgent);
      currentAgent = null;
    }
    
    if (entry.event === 'agent_error' && currentAgent && currentStage) {
      currentAgent.status = 'failed';
      currentAgent.error = entry.data?.error as string;
      currentStage.agents.push(currentAgent);
      currentAgent = null;
    }
    
    // 检测 Stage 结束
    if (entry.event === 'stage_complete' && currentStage) {
      currentStage.status = 'completed';
      currentStage.endTime = entry.timestamp;
    }
    
    if (entry.event === 'stage_error' && currentStage) {
      currentStage.status = 'failed';
      currentStage.endTime = entry.timestamp;
    }
  }
  
  // 添加最后一个 stage
  if (currentStage) {
    stages.push(currentStage);
  }
  
  const firstEntry = entries[0];
  
  return {
    id: firstEntry.timestamp,
    execution: {
      id: firstEntry.timestamp,
      projectId: '',
      timestamp: firstEntry.timestamp,
      pipelineType: (firstEntry.data?.pipeline as any) || 'write',
      chapterNumber: firstEntry.data?.chapter as number,
      status: entries[entries.length - 1].level === 'error' ? 'failed' : 'completed'
    },
    stages
  };
}

function mapStageType(stageName: string): PipelineStage['type'] {
  if (stageName.includes('context')) return 'context';
  if (stageName.includes('draft')) return 'draft';
  if (stageName.includes('pass')) return 'pass';
  if (stageName.includes('review')) return 'review';
  if (stageName.includes('data')) return 'data';
  return 'draft';
}
