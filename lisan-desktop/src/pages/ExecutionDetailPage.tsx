import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import type { ExecutionDetail } from "@/types/lisan";
import { PipelineStageCard } from "@/components/timeline/pipeline-stage";
import { api } from "@/api";

export default function ExecutionDetailPage() {
  const { id: projectId, execId } = useParams<{
    id: string;
    execId: string;
  }>();
  const [detail, setDetail] = useState<ExecutionDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!projectId || !execId) return;
    api
      .getExecutionDetail(projectId, execId)
      .then(setDetail)
      .catch(console.error)
      .finally(() => setIsLoading(false));
  }, [projectId, execId]);

  if (isLoading) {
    return (
      <div className="container mx-auto p-8">
        <Skeleton className="h-8 w-64 mb-8" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="container mx-auto p-8">
        <div className="text-center py-12 text-muted-foreground">
          执行详情加载失败
        </div>
      </div>
    );
  }

  const completedStages = detail.stages.filter(
    (s) => s.status === "completed"
  ).length;
  const progress = (completedStages / detail.stages.length) * 100;

  return (
    <div className="container mx-auto p-8">
      <div className="mb-8">
        <Link
          to={`/projects/${projectId}`}
          className="text-sm text-muted-foreground hover:underline"
        >
          ← 返回执行历史
        </Link>
        <h1 className="text-3xl font-bold mt-4">执行详情</h1>
        <p className="text-sm text-muted-foreground mt-2">
          {new Date(detail.execution.timestamp).toLocaleString("zh-CN")}
        </p>

        <div className="mt-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">执行进度</span>
            <span className="text-sm text-muted-foreground">
              {completedStages} / {detail.stages.length} 阶段完成
            </span>
          </div>
          <Progress value={progress} />
        </div>
      </div>

      <div className="space-y-6">
        {detail.stages.map((stage, index) => (
          <PipelineStageCard key={index} stage={stage} />
        ))}
      </div>
    </div>
  );
}
