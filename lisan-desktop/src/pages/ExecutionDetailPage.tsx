import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useSidecar } from "@/hooks/useSidecar";
import { useAppStore } from "@/lib/store";
import type {
  AgentDefinition,
  ExecutionDetail,
  ExecutionStep,
  StepStatus,
  WorkflowDefinition,
  WorkflowNotification,
} from "@/types/engine";

interface StepViewModel extends ExecutionStep {
  runtimeError?: string;
}

function statusVariant(status: StepStatus | "running"): "default" | "secondary" | "destructive" {
  if (status === "completed") {
    return "default";
  }
  if (status === "failed") {
    return "destructive";
  }
  return "secondary";
}

function applyEventToSteps(steps: StepViewModel[], event: WorkflowNotification): StepViewModel[] {
  const params = event.params ?? {};
  const stepId = typeof params.stepId === "string" ? params.stepId : undefined;
  if (!stepId) {
    return steps;
  }

  const index = steps.findIndex((step) => step.stepId === stepId);
  const base =
    index >= 0
      ? steps[index]
      : {
          id: `live-${stepId}`,
          executionId: typeof params.executionId === "string" ? params.executionId : "",
          stepId,
          agentId: typeof params.agentId === "string" ? params.agentId : "unknown",
          status: "pending" as StepStatus,
          order: steps.length,
        };

  let next: StepViewModel = base;
  if (event.method === "step:start") {
    next = {
      ...base,
      status: "running" as StepStatus,
      agentId: typeof params.agentId === "string" ? params.agentId : base.agentId,
    };
  } else if (event.method === "step:complete") {
    next = {
      ...base,
      status: "completed",
      output: typeof params.output === "string" ? params.output : base.output,
      tokens: typeof params.tokens === "number" ? params.tokens : base.tokens,
      duration: typeof params.duration === "number" ? params.duration : base.duration,
      runtimeError: undefined,
    };
  } else if (event.method === "step:failed") {
    next = {
      ...base,
      status: "failed",
      runtimeError: typeof params.error === "string" ? params.error : "未知错误",
    };
  } else if (event.method === "step:skipped") {
    next = {
      ...base,
      status: "skipped",
      runtimeError: undefined,
    };
  } else if (event.method === "step:progress") {
    const chunk = typeof params.chunk === "string" ? params.chunk : "";
    next = {
      ...base,
      status: "running" as StepStatus,
      output: `${base.output ?? ""}${chunk}`,
    };
  } else {
    return steps;
  }

  if (index >= 0) {
    const result = [...steps];
    result[index] = next;
    return result;
  }
  return [...steps, next];
}

export default function ExecutionDetailPage() {
  const { id: routeProjectId, execId } = useParams<{ id: string; execId: string }>();
  const sidecar = useSidecar();
  const workflowEvents = useAppStore((state) => state.workflowEvents);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<ExecutionDetail | null>(null);
  const [steps, setSteps] = useState<StepViewModel[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowDefinition[]>([]);
  const [agents, setAgents] = useState<AgentDefinition[]>([]);
  const [pausing, setPausing] = useState(false);
  const [aborting, setAborting] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [skipPendingStepId, setSkipPendingStepId] = useState<string | null>(null);
  const [controlFeedback, setControlFeedback] = useState<string | null>(null);

  const loadDetail = async () => {
    if (!execId) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const executionDetail = await sidecar.executionDetail(execId);
      setDetail(executionDetail);
      setSteps(executionDetail.steps);

      const projectId = executionDetail.execution.projectId;
      const [workflowList, agentList] = await Promise.all([
        sidecar.workflowList(projectId),
        sidecar.agentList(),
      ]);
      setWorkflows(workflowList);
      setAgents(agentList);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadDetail();
  }, [execId]);

  const latestEvent = workflowEvents[workflowEvents.length - 1];
  useEffect(() => {
    if (!latestEvent || !latestEvent.method.startsWith("step:")) {
      return;
    }
    const eventExecutionId =
      typeof latestEvent.params?.executionId === "string" ? latestEvent.params.executionId : undefined;
    if (!execId || eventExecutionId !== execId) {
      return;
    }
    setSteps((current) => applyEventToSteps(current, latestEvent));
  }, [latestEvent, execId]);

  useEffect(() => {
    if (!latestEvent) {
      return;
    }
    const eventExecutionId =
      typeof latestEvent.params?.executionId === "string" ? latestEvent.params.executionId : undefined;
    if (!execId || eventExecutionId !== execId) {
      return;
    }

    if (latestEvent.method === "step:skipped") {
      const skippedStepId =
        typeof latestEvent.params?.stepId === "string" ? latestEvent.params.stepId : undefined;
      if (skippedStepId && skippedStepId === skipPendingStepId) {
        setSkipPendingStepId(null);
        setControlFeedback("当前步骤已跳过。");
      }
      return;
    }

    if (latestEvent.method === "step:complete") {
      const completedStepId =
        typeof latestEvent.params?.stepId === "string" ? latestEvent.params.stepId : undefined;
      if (completedStepId && completedStepId === skipPendingStepId) {
        setSkipPendingStepId(null);
        setControlFeedback("当前步骤已完成，跳过请求未生效。");
      }
      return;
    }

    if (latestEvent.method === "workflow:complete" && aborting) {
      setAborting(false);
      setControlFeedback("执行已终止。");
    }
  }, [latestEvent, execId, skipPendingStepId, aborting]);

  const workflowNameMap = useMemo(
    () =>
      Object.fromEntries(workflows.map((workflow) => [workflow.id, workflow.name])) as Record<
        string,
        string
      >,
    [workflows],
  );
  const agentNameMap = useMemo(
    () => Object.fromEntries(agents.map((agent) => [agent.id, agent.name])) as Record<string, string>,
    [agents],
  );

  const completedCount = steps.filter((step) => step.status === "completed").length;
  const progress = steps.length === 0 ? 0 : (completedCount / steps.length) * 100;
  const activeStep = steps.find((step) => step.status === "running");

  const runControl = async (action: "pause" | "resume" | "abort" | "skip") => {
    if (!execId) {
      setError("缺少 executionId，无法执行控制操作。");
      return;
    }
    if (action === "skip" && !activeStep) {
      return;
    }
    setError(null);
    try {
      if (action === "pause") {
        setPausing(true);
        await sidecar.workflowPause(execId);
        setIsPaused(true);
      } else if (action === "resume") {
        setPausing(true);
        await sidecar.workflowResume(execId);
        setIsPaused(false);
      } else if (action === "abort") {
        setAborting(true);
        setControlFeedback("正在中断当前步骤...");
        await sidecar.workflowAbort(execId);
      } else if (action === "skip" && activeStep) {
        setSkipPendingStepId(activeStep.stepId);
        setControlFeedback("正在跳过当前步骤...");
        await sidecar.workflowSkip(execId, activeStep.stepId);
      }
    } catch (reason: unknown) {
      if (action === "abort") {
        setAborting(false);
      }
      if (action === "skip") {
        setSkipPendingStepId(null);
      }
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setPausing(false);
    }
  };

  if (loading) {
    return <p className="text-sm text-muted-foreground">正在加载执行详情...</p>;
  }

  if (!detail) {
    return (
      <div className="space-y-3">
        <Link to={`/projects/${routeProjectId}/executions`} className="text-sm text-muted-foreground hover:underline">
          ← 返回执行列表
        </Link>
        <p className="text-sm text-muted-foreground">未找到执行详情。</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="space-y-1">
          <Link
            to={`/projects/${routeProjectId}/executions`}
            className="text-sm text-muted-foreground hover:underline"
          >
            ← 返回执行列表
          </Link>
          <h2 className="text-lg font-semibold">执行详情：{detail.execution.id}</h2>
          <p className="text-xs text-muted-foreground">
            工作流：{workflowNameMap[detail.execution.workflowId] ?? detail.execution.workflowId}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant={statusVariant(detail.execution.status)}>
            {detail.execution.status}
          </Badge>
          <Button variant="outline" onClick={() => runControl(isPaused ? "resume" : "pause")} disabled={pausing}>
            {isPaused ? "恢复" : "暂停"}
          </Button>
          <Button
            variant="outline"
            onClick={() => runControl("skip")}
            disabled={!activeStep || Boolean(skipPendingStepId) || aborting}
          >
            {skipPendingStepId ? "正在跳过..." : "跳过当前步骤"}
          </Button>
          <Button variant="destructive" onClick={() => runControl("abort")} disabled={aborting}>
            {aborting ? "正在中断..." : "终止"}
          </Button>
          <Button variant="outline" onClick={() => void loadDetail()}>
            刷新
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {controlFeedback && !error && (
        <div className="rounded-md border border-border/70 bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
          {controlFeedback}
        </div>
      )}

      <div className="rounded-md border border-border/70 bg-muted/20 p-3">
        <div className="mb-2 flex items-center justify-between text-sm">
          <span>整体进度</span>
          <span className="text-muted-foreground">
            {completedCount}/{steps.length}
          </span>
        </div>
        <Progress value={progress} />
      </div>

      <div className="space-y-2">
        {steps.length === 0 ? (
          <div className="rounded-md border border-dashed border-border p-5 text-sm text-muted-foreground">
            当前执行还没有步骤详情。
          </div>
        ) : (
          steps.map((step, index) => (
            <div key={`${step.id}-${step.stepId}`} className="rounded-lg border border-border/70 p-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-medium">
                    Step {index + 1} · {agentNameMap[step.agentId] ?? step.agentId}
                  </p>
                  <p className="text-xs text-muted-foreground">stepId: {step.stepId}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={statusVariant(step.status)}>
                    {step.status}
                  </Badge>
                  {typeof step.tokens === "number" && (
                    <span className="text-xs text-muted-foreground">tokens: {step.tokens}</span>
                  )}
                  {typeof step.duration === "number" && (
                    <span className="text-xs text-muted-foreground">
                      duration: {(step.duration / 1000).toFixed(2)}s
                    </span>
                  )}
                </div>
              </div>
              {step.input && (
                <details className="mb-2">
                  <summary className="cursor-pointer text-sm text-muted-foreground">查看输入</summary>
                  <pre className="mt-2 max-h-40 overflow-auto rounded-md border border-border/60 bg-muted/20 p-2 text-xs whitespace-pre-wrap">
                    {step.input}
                  </pre>
                </details>
              )}
              <details open={step.status === "running"}>
                <summary className="cursor-pointer text-sm text-muted-foreground">查看输出</summary>
                <pre className="mt-2 max-h-64 overflow-auto rounded-md border border-border/60 bg-muted/20 p-2 text-xs whitespace-pre-wrap">
                  {step.output ?? "暂无输出"}
                </pre>
              </details>
              {step.runtimeError && (
                <p className="mt-2 text-xs text-destructive">错误：{step.runtimeError}</p>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
