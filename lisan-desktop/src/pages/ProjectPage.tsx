import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/api";
import type { Execution } from "@/types/lisan";

export default function ProjectPage() {
  const { id: projectId } = useParams<{ id: string }>();
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!projectId) return;
    api
      .getExecutions(projectId)
      .then(setExecutions)
      .catch(console.error)
      .finally(() => setIsLoading(false));
  }, [projectId]);

  if (isLoading) {
    return (
      <div className="container mx-auto p-8">
        <Skeleton className="h-8 w-64 mb-8" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  return (
    <div className="container mx-auto p-8">
      <div className="mb-8">
        <Link to="/" className="text-sm text-muted-foreground hover:underline">
          ← 返回项目列表
        </Link>
        <div className="flex items-center justify-between mt-4">
          <div>
            <h1 className="text-3xl font-bold">{projectId}</h1>
          </div>
          <Link to={`/projects/${projectId}/workspace`}>
            <button className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90">
              进入工作台
            </button>
          </Link>
        </div>
      </div>

      {executions.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          暂无执行记录
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>执行时间</TableHead>
              <TableHead>Pipeline 类型</TableHead>
              <TableHead>章节号</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>耗时</TableHead>
              <TableHead>操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {executions.map((execution) => (
              <TableRow key={execution.id}>
                <TableCell>
                  {new Date(execution.timestamp).toLocaleString("zh-CN")}
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{execution.pipelineType}</Badge>
                </TableCell>
                <TableCell>
                  {execution.chapterNumber
                    ? `第 ${execution.chapterNumber} 章`
                    : "-"}
                </TableCell>
                <TableCell>
                  <Badge
                    variant={
                      execution.status === "completed"
                        ? "default"
                        : "destructive"
                    }
                  >
                    {execution.status}
                  </Badge>
                </TableCell>
                <TableCell>
                  {execution.duration
                    ? `${(execution.duration / 1000).toFixed(1)}s`
                    : "-"}
                </TableCell>
                <TableCell>
                  <Link
                    to={`/projects/${projectId}/executions/${execution.id}`}
                    className="text-sm text-primary hover:underline"
                  >
                    查看详情
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
