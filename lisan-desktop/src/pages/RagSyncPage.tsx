import { Link, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAppStore } from "@/lib/store";
import { getRagSyncState } from "@/lib/rag-sync-state";

export default function RagSyncPage() {
  const { id: routeProjectId } = useParams<{ id: string }>();
  const currentProject = useAppStore((state) => state.currentProject);
  const ragSyncState = getRagSyncState();

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Link
          to={routeProjectId ? `/projects/${routeProjectId}/settings` : "/"}
          className="text-sm text-muted-foreground hover:underline"
        >
          ← 返回项目设置
        </Link>
        <h2 className="text-lg font-semibold">RAG 同步</h2>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <CardTitle>RAG 同步</CardTitle>
            <Badge variant="secondary">{ragSyncState.title}</Badge>
          </div>
          <CardDescription>{ragSyncState.reason}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>当前项目：{currentProject?.name ?? routeProjectId ?? "未识别项目"}</p>
          <p>当前版本仅保留状态说明，暂不提供可执行同步按钮，避免出现“可点击但无效果”的误导。</p>
          <Button variant="outline" disabled>
            {ragSyncState.actionLabel}
          </Button>
          {routeProjectId && (
            <Link to={`/projects/${routeProjectId}/executions`}>
              <Button variant="ghost">查看执行列表</Button>
            </Link>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
