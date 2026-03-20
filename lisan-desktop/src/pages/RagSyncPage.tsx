import { Link, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAppStore } from "@/lib/store";

export default function RagSyncPage() {
  const { id: routeProjectId } = useParams<{ id: string }>();
  const currentProject = useAppStore((state) => state.currentProject);

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
          <CardTitle>同步入口已接入</CardTitle>
          <CardDescription>
            此页面为设置页中的 RAG 同步入口对应路由（`/projects/:id/settings/rag-sync`）。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>当前项目：{currentProject?.name ?? routeProjectId ?? "未识别项目"}</p>
          <p>桌面端当前以 sidecar 为主数据面。RAG 同步执行链路会在后续迭代收敛到统一入口。</p>
          {routeProjectId && (
            <Link to={`/projects/${routeProjectId}/executions`}>
              <Button variant="outline">查看执行列表</Button>
            </Link>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
