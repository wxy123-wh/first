import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useSidecar } from "@/hooks/useSidecar";
import { resolveDisplayName } from "@/lib/display-name";
import { useAppStore } from "@/lib/store";
import type { Chapter, Execution, WorkflowDefinition } from "@/types/engine";

function statusVariant(status: Execution["status"]): "default" | "secondary" | "destructive" {
  if (status === "completed") {
    return "default";
  }
  if (status === "failed") {
    return "destructive";
  }
  return "secondary";
}

function formatDuration(startedAt: string, completedAt?: string): string {
  if (!completedAt) {
    return "进行中";
  }
  const start = Date.parse(startedAt);
  const end = Date.parse(completedAt);
  if (Number.isNaN(start) || Number.isNaN(end)) {
    return "-";
  }
  const delta = Math.max(0, end - start);
  const seconds = Math.floor(delta / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remain = seconds % 60;
  return `${minutes}m ${remain}s`;
}

export default function ExecutionsPage() {
  const sidecar = useSidecar();
  const { id: routeProjectId } = useParams<{ id: string }>();
  const currentProject = useAppStore((state) => state.currentProject);
  const workflowEvents = useAppStore((state) => state.workflowEvents);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowDefinition[]>([]);

  useEffect(() => {
    if (!currentProject?.id) {
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([
      sidecar.executionList(currentProject.id),
      sidecar.chapterList(currentProject.id),
      sidecar.workflowList(currentProject.id),
    ])
      .then(([executionList, chapterList, workflowList]) => {
        if (cancelled) {
          return;
        }
        setExecutions(executionList);
        setChapters(chapterList);
        setWorkflows(workflowList);
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [currentProject?.id, sidecar]);

  const chapterNameMap = useMemo(
    () =>
      Object.fromEntries(
        chapters.map((chapter) => [chapter.id, `第${chapter.number}章 ${chapter.title}`]),
      ) as Record<string, string>,
    [chapters],
  );

  const workflowNameMap = useMemo(
    () =>
      Object.fromEntries(workflows.map((workflow) => [workflow.id, workflow.name])) as Record<
        string,
        string
      >,
    [workflows],
  );
  const hasBrokenReferences = useMemo(
    () =>
      executions.some(
        (execution) =>
          (execution.chapterId && !chapterNameMap[execution.chapterId]) ||
          !workflowNameMap[execution.workflowId],
      ),
    [executions, chapterNameMap, workflowNameMap],
  );

  if (!currentProject?.id) {
    return <p className="text-sm text-muted-foreground">请先打开项目。</p>;
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground">正在加载执行历史...</p>;
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">执行历史</h2>
        <p className="text-xs text-muted-foreground">
          最近事件：{workflowEvents[workflowEvents.length - 1]?.method ?? "暂无"}
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}
      {hasBrokenReferences && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-900">
          检测到引用失效：部分执行记录关联的章节或工作流已删除，列表已自动显示可读兜底名称。
        </div>
      )}

      {executions.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          暂无执行记录。可以在章节页点击“运行”触发工作流。
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>章节</TableHead>
              <TableHead>工作流</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>开始时间</TableHead>
              <TableHead>耗时</TableHead>
              <TableHead>操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {executions.map((execution) => (
              <TableRow key={execution.id}>
                <TableCell>
                  {resolveDisplayName({
                    id: execution.chapterId,
                    nameById: chapterNameMap,
                    emptyLabel: "无",
                    missingLabel: "已删除章节",
                  })}
                </TableCell>
                <TableCell>
                  {resolveDisplayName({
                    id: execution.workflowId,
                    nameById: workflowNameMap,
                    emptyLabel: "未知工作流",
                    missingLabel: "已删除工作流",
                  })}
                </TableCell>
                <TableCell>
                  <Badge variant={statusVariant(execution.status)}>{execution.status}</Badge>
                </TableCell>
                <TableCell>{new Date(execution.startedAt).toLocaleString("zh-CN")}</TableCell>
                <TableCell>{formatDuration(execution.startedAt, execution.completedAt)}</TableCell>
                <TableCell>
                  <Link
                    className="text-sm text-primary underline-offset-4 hover:underline"
                    to={`/projects/${routeProjectId}/executions/${execution.id}`}
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
