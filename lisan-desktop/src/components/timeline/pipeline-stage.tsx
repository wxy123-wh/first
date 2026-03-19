import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { PipelineStage } from '@/types/lisan';
import { AgentCard } from './agent-card';

interface PipelineStageCardProps {
  stage: PipelineStage;
}

export function PipelineStageCard({ stage }: PipelineStageCardProps) {
  const duration = stage.startTime && stage.endTime
    ? (new Date(stage.endTime).getTime() - new Date(stage.startTime).getTime()) / 1000
    : 0;

  return (
    <Card className="mb-6">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-xl">{stage.name}</CardTitle>
          <Badge variant={stage.status === 'completed' ? 'default' : 'destructive'}>
            {stage.status}
          </Badge>
        </div>
        <CardDescription>
          {stage.startTime && `开始: ${new Date(stage.startTime).toLocaleTimeString('zh-CN')}`}
          {duration > 0 && ` | 耗时: ${duration.toFixed(1)}s`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {stage.agents.map((agent, index) => (
            <AgentCard key={index} agent={agent} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
