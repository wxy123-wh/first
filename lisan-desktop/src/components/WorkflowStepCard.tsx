import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { WorkflowStep } from "@/types/engine";

interface WorkflowStepCardProps {
  step: WorkflowStep;
  agentName: string;
  agentSummary: string;
  dragHandle?: React.ReactNode;
  onChange: (step: WorkflowStep) => void;
  onDelete: () => void;
}

function numberOrUndefined(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  const parsed = Number(trimmed);
  return Number.isNaN(parsed) ? undefined : parsed;
}

export default function WorkflowStepCard({
  step,
  agentName,
  agentSummary,
  dragHandle,
  onChange,
  onDelete,
}: WorkflowStepCardProps) {
  const [expanded, setExpanded] = useState(false);

  const config = useMemo(() => step.config ?? {}, [step.config]);

  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          {dragHandle}
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{step.order + 1}. {agentName}</span>
              <Badge variant={step.enabled ? "default" : "secondary"}>
                {step.enabled ? "启用" : "禁用"}
              </Badge>
            </div>
            <p className="line-clamp-2 text-xs text-muted-foreground">
              {agentSummary || "该智能体暂无 agent.md 内容"}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={step.enabled}
              onChange={(event) =>
                onChange({
                  ...step,
                  enabled: event.target.checked,
                })
              }
            />
            启用
          </label>
          <Button size="sm" variant="outline" onClick={() => setExpanded((value) => !value)}>
            {expanded ? "收起" : "配置"}
          </Button>
          <Button size="sm" variant="destructive" onClick={onDelete}>
            删除
          </Button>
        </div>
      </div>

      {expanded && (
        <div className="mt-3 grid gap-3 border-t border-border/60 pt-3 md:grid-cols-2">
          <div className="space-y-2">
            <Label>Provider 覆盖</Label>
            <Input
              value={config.provider ?? ""}
              onChange={(event) =>
                onChange({
                  ...step,
                  config: {
                    ...config,
                    provider: event.target.value.trim() || undefined,
                  },
                })
              }
              placeholder="openai / anthropic / newapi"
            />
          </div>
          <div className="space-y-2">
            <Label>Model 覆盖</Label>
            <Input
              value={config.model ?? ""}
              onChange={(event) =>
                onChange({
                  ...step,
                  config: {
                    ...config,
                    model: event.target.value.trim() || undefined,
                  },
                })
              }
              placeholder="gpt-4o / claude-opus-4"
            />
          </div>
          <div className="space-y-2">
            <Label>Temperature 覆盖</Label>
            <Input
              type="number"
              step="0.1"
              min="0"
              max="2"
              value={config.temperature ?? ""}
              onChange={(event) =>
                onChange({
                  ...step,
                  config: {
                    ...config,
                    temperature: numberOrUndefined(event.target.value),
                  },
                })
              }
            />
          </div>
          <div className="space-y-2">
            <Label>Max Tokens 覆盖</Label>
            <Input
              type="number"
              step="1"
              min="1"
              value={config.maxTokens ?? ""}
              onChange={(event) =>
                onChange({
                  ...step,
                  config: {
                    ...config,
                    maxTokens: numberOrUndefined(event.target.value),
                  },
                })
              }
            />
          </div>
        </div>
      )}
    </div>
  );
}
