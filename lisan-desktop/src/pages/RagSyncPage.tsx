import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useSidecar } from "@/hooks/useSidecar";
import { useAppStore } from "@/lib/store";
import { getRagSyncState } from "@/lib/rag-sync-state";
import type { RagSyncStage, RagSyncStatus } from "@/types/engine";

type SidecarRagEventPayload = {
  method?: string;
  params?: unknown;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function parseRagStatus(value: unknown): RagSyncStatus | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const stats = asRecord(record.stats);
  const failures = Array.isArray(record.failures)
    ? record.failures
        .map((entry) => asRecord(entry))
        .filter((entry): entry is Record<string, unknown> => Boolean(entry))
        .map((entry) => ({
          file: asString(entry.file) ?? "未知文件",
          reason: asString(entry.reason) ?? "未知错误",
        }))
    : [];
  const stageRaw = asString(record.stage) ?? "idle";
  const stage = ["idle", "scanning", "syncing", "completed", "failed"].includes(stageRaw)
    ? (stageRaw as RagSyncStage)
    : "idle";

  return {
    stage,
    running: Boolean(record.running),
    runId: asString(record.runId),
    startedAt: asString(record.startedAt),
    completedAt: asString(record.completedAt),
    message: asString(record.message) ?? "",
    currentFile: asString(record.currentFile),
    stats: {
      total: asNumber(stats?.total),
      processed: asNumber(stats?.processed),
      succeeded: asNumber(stats?.succeeded),
      failed: asNumber(stats?.failed),
    },
    failures,
  };
}

function stageLabel(stage: RagSyncStage): string {
  if (stage === "idle") return "未开始";
  if (stage === "scanning") return "扫描中";
  if (stage === "syncing") return "同步中";
  if (stage === "completed") return "已完成";
  return "失败";
}

function progressValue(status: RagSyncStatus | null): number {
  if (!status) {
    return 0;
  }
  if (status.stats.total <= 0) {
    return status.stage === "completed" ? 100 : 0;
  }
  return Math.max(0, Math.min(100, (status.stats.processed / status.stats.total) * 100));
}

function primaryActionLabel(status: RagSyncStatus | null): string {
  if (!status) {
    return "开始同步";
  }
  if (status.running) {
    return "同步中...";
  }
  if (status.stage === "failed" || status.stats.failed > 0) {
    return "重试同步";
  }
  return "开始同步";
}

export default function RagSyncPage() {
  const sidecar = useSidecar();
  const { id: routeProjectId } = useParams<{ id: string }>();
  const currentProject = useAppStore((state) => state.currentProject);
  const ragSyncState = getRagSyncState();

  const [status, setStatus] = useState<RagSyncStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [runningAction, setRunningAction] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const pct = useMemo(() => progressValue(status), [status]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    sidecar
      .ragStatus()
      .then((nextStatus) => {
        if (!cancelled) {
          setStatus(nextStatus);
        }
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
  }, [sidecar]);

  useEffect(() => {
    let unlisteners: UnlistenFn[] = [];
    let disposed = false;
    const register = async () => {
      const callback = (event: { payload: SidecarRagEventPayload }) => {
        const next = parseRagStatus(asRecord(event.payload)?.params);
        if (!next) {
          return;
        }
        setStatus(next);
        if (next.stage === "completed") {
          setNotice("RAG 同步已完成。");
          setError(null);
        } else if (next.stage === "failed") {
          setError(next.message || "RAG 同步失败。");
          setNotice(null);
        }
      };
      const onStart = await listen<SidecarRagEventPayload>("sidecar:rag:sync:start", callback);
      const onProgress = await listen<SidecarRagEventPayload>("sidecar:rag:sync:progress", callback);
      const onComplete = await listen<SidecarRagEventPayload>("sidecar:rag:sync:complete", callback);
      const onFailed = await listen<SidecarRagEventPayload>("sidecar:rag:sync:failed", callback);
      unlisteners = [onStart, onProgress, onComplete, onFailed];
    };
    register().catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : String(reason));
    });
    return () => {
      disposed = true;
      if (disposed) {
        unlisteners.forEach((unlisten) => {
          void unlisten();
        });
      }
    };
  }, []);

  const refreshStatus = async () => {
    setRunningAction(true);
    setError(null);
    try {
      const nextStatus = await sidecar.ragStatus();
      setStatus(nextStatus);
      setNotice("状态已刷新。");
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setNotice(null);
    } finally {
      setRunningAction(false);
    }
  };

  const startSync = async () => {
    setRunningAction(true);
    setError(null);
    setNotice(null);
    try {
      const result = await sidecar.ragSync();
      setStatus(result.status);
      if (result.started) {
        setNotice("已开始同步。");
      } else {
        setNotice("同步任务已在运行。");
      }
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setRunningAction(false);
    }
  };

  if (loading) {
    return <p className="text-sm text-muted-foreground">正在加载同步状态...</p>;
  }

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

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700">
          {notice}
        </div>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <CardTitle>RAG 同步</CardTitle>
            <Badge variant="secondary">{ragSyncState.title}</Badge>
            <Badge variant="outline">{stageLabel(status?.stage ?? "idle")}</Badge>
          </div>
          <CardDescription>{ragSyncState.reason}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            当前项目：{currentProject?.name ?? routeProjectId ?? "未识别项目"}
          </p>
          <div className="space-y-1">
            <div className="flex items-center justify-between text-sm">
              <span>同步进度</span>
              <span className="text-muted-foreground tabular-nums">{Math.round(pct)}%</span>
            </div>
            <Progress value={pct} />
          </div>
          <p className="text-sm text-muted-foreground">
            {status?.message || "尚未开始同步。"}
            {status?.currentFile ? `（${status.currentFile}）` : ""}
          </p>
          <div className="grid gap-2 text-sm md:grid-cols-4">
            <div className="rounded-md border p-2">
              <p className="text-muted-foreground">总文件</p>
              <p className="font-medium">{status?.stats.total ?? 0}</p>
            </div>
            <div className="rounded-md border p-2">
              <p className="text-muted-foreground">已处理</p>
              <p className="font-medium">{status?.stats.processed ?? 0}</p>
            </div>
            <div className="rounded-md border p-2">
              <p className="text-muted-foreground">成功</p>
              <p className="font-medium text-emerald-700">{status?.stats.succeeded ?? 0}</p>
            </div>
            <div className="rounded-md border p-2">
              <p className="text-muted-foreground">失败</p>
              <p className="font-medium text-destructive">{status?.stats.failed ?? 0}</p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void startSync()} disabled={runningAction || status?.running}>
              {primaryActionLabel(status)}
            </Button>
            <Button variant="outline" onClick={() => void refreshStatus()} disabled={runningAction}>
              查看结果
            </Button>
          </div>
        </CardContent>
      </Card>

      {(status?.failures.length ?? 0) > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>失败明细</CardTitle>
            <CardDescription>可以修复后点击“重试同步”。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {status?.failures.slice(0, 20).map((failure, index) => (
              <div key={`${failure.file}-${index}`} className="rounded-md border p-2 text-sm">
                <p className="font-medium">{failure.file}</p>
                <p className="text-muted-foreground">{failure.reason}</p>
              </div>
            ))}
            {(status?.failures.length ?? 0) > 20 && (
              <p className="text-xs text-muted-foreground">
                仅展示前 20 条失败记录，请刷新查看最新状态。
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
