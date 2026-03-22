import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useSidecar } from "@/hooks/useSidecar";
import { findMissingReferenceIds, resolveDisplayName } from "@/lib/display-name";
import { useAppStore } from "@/lib/store";
import type {
  AgentDefinition,
  ExecutionDetail,
  ExecutionStatus,
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

function asExecutionStatus(value: unknown): ExecutionStatus | null {
  if (value === "pending" || value === "running" || value === "completed" || value === "failed") {
    return value;
  }
  return null;
}

export function syncExecutionStatusFromEvent(
  currentStatus: ExecutionStatus,
  event: WorkflowNotification,
): ExecutionStatus {
  if (event.method === "workflow:start") {
    return "running";
  }
  if (event.method === "step:failed") {
    return "failed";
  }
  if (event.method === "workflow:complete") {
    const statusFromEvent = asExecutionStatus(event.params?.status);
    if (statusFromEvent) {
      return statusFromEvent;
    }
    return currentStatus === "failed" ? "failed" : "completed";
  }
  return currentStatus;
}

export function shouldRefreshExecutionDetail(event: WorkflowNotification): boolean {
  return event.method === "workflow:complete" || event.method === "step:failed";
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
  const [showInternalIds, setShowInternalIds] = useState(false);

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

    setDetail((current) => {
      if (!current) {
        return current;
      }
      const nextStatus = syncExecutionStatusFromEvent(current.execution.status, latestEvent);
      if (nextStatus === current.execution.status) {
        return current;
      }
      return {
        ...current,
        execution: {
          ...current.execution,
          status: nextStatus,
        },
      };
    });

    if (shouldRefreshExecutionDetail(latestEvent)) {
      void loadDetail();
    }
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
  const hasMissingWorkflowReference = useMemo(
    () => !!detail && !workflowNameMap[detail.execution.workflowId],
    [detail, workflowNameMap],
  );
  const missingAgentIds = useMemo(
    () => findMissingReferenceIds(steps.map((step) => step.agentId), agentNameMap),
    [steps, agentNameMap],
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
          <h2 className="text-lg font-semibold">执行详情</h2>
          {showInternalIds && (
            <p className="text-xs text-muted-foreground">executionId: {detail.execution.id}</p>
          )}
          <p className="text-xs text-muted-foreground">
            工作流：
            {resolveDisplayName({
              id: detail.execution.workflowId,
              nameById: workflowNameMap,
              emptyLabel: "未知工作流",
              missingLabel: "已删除工作流",
            })}
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
          <Button variant={showInternalIds ? "secondary" : "outline"} onClick={() => setShowInternalIds((v) => !v)}>
            {showInternalIds ? "隐藏诊断ID" : "诊断视图"}
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
      {(hasMissingWorkflowReference || missingAgentIds.length > 0) && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-900">
          引用失效：
          {hasMissingWorkflowReference && " 当前执行关联的工作流已删除。"}
          {missingAgentIds.length > 0 &&
            ` 以下步骤引用的智能体已删除：${missingAgentIds
              .map((agentId) =>
                resolveDisplayName({
                  id: agentId,
                  nameById: agentNameMap,
                  emptyLabel: "未知智能体",
                  missingLabel: "已删除智能体",
                }),
              )
              .join("、")}。`}
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
                    Step {index + 1} ·{" "}
                    {resolveDisplayName({
                      id: step.agentId,
                      nameById: agentNameMap,
                      emptyLabel: "未知智能体",
                      missingLabel: "已删除智能体",
                    })}
                  </p>
                  {showInternalIds && (
                    <p className="text-xs text-muted-foreground">stepId: {step.stepId}</p>
                  )}
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
