import { useEffect, useMemo, useState } from "react";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  type DragEndEvent,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import WorkflowStepCard from "@/components/WorkflowStepCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSidecar } from "@/hooks/useSidecar";
import { useAppStore } from "@/lib/store";
import { inferWorkflowKind, splitWorkflowsByKind, type WorkflowKind } from "@/lib/workflow-kind";
import type { AgentDefinition, WorkflowDefinition, WorkflowStep } from "@/types/engine";

function newStep(agentId: string, order: number): WorkflowStep {
  return {
    id: crypto.randomUUID(),
    order,
    agentId,
    enabled: true,
  };
}

function normalizeStepOrder(steps: WorkflowStep[]): WorkflowStep[] {
  return steps.map((step, index) => ({
    ...step,
    order: index,
  }));
}

function workflowKindLabel(kind: WorkflowKind): string {
  return kind === "scene" ? "场景工作流" : "章节生成工作流";
}

interface SortableStepProps {
  step: WorkflowStep;
  agentName: string;
  agentSummary: string;
  onChange: (nextStep: WorkflowStep) => void;
  onDelete: () => void;
}

function SortableStep({ step, agentName, agentSummary, onChange, onDelete }: SortableStepProps) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: step.id });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
    >
      <WorkflowStepCard
        step={step}
        agentName={agentName}
        agentSummary={agentSummary}
        onChange={onChange}
        onDelete={onDelete}
        dragHandle={
          <button
            type="button"
            className="mt-0.5 rounded border border-border p-1 text-muted-foreground hover:bg-muted"
            {...attributes}
            {...listeners}
            aria-label="拖拽排序"
          >
            <GripVertical className="size-4" />
          </button>
        }
      />
    </div>
  );
}

export default function WorkflowsPage() {
  const sidecar = useSidecar();
  const currentProject = useAppStore((state) => state.currentProject);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [workflows, setWorkflows] = useState<WorkflowDefinition[]>([]);
  const [agents, setAgents] = useState<AgentDefinition[]>([]);
  const [agentSummaries, setAgentSummaries] = useState<Record<string, string>>({});
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string>("");
  const [draft, setDraft] = useState<WorkflowDefinition | null>(null);
  const [newStepAgentId, setNewStepAgentId] = useState<string>("");

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const loadData = async () => {
    if (!currentProject?.id) {
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const [workflowList, agentList] = await Promise.all([
        sidecar.workflowList(currentProject.id),
        sidecar.agentList(),
      ]);
      setWorkflows(workflowList);
      setAgents(agentList);

      const summaryEntries = await Promise.all(
        agentList.map(async (agent) => {
          try {
            const md = await sidecar.agentGetMd(agent.id);
            return [agent.id, md.split("\n").find((line) => line.trim()) ?? ""] as const;
          } catch {
            return [agent.id, ""] as const;
          }
        }),
      );
      setAgentSummaries(Object.fromEntries(summaryEntries));

      const grouped = splitWorkflowsByKind(workflowList);
      const nextWorkflow = grouped.chapter[0] ?? grouped.scene[0] ?? null;
      setSelectedWorkflowId(nextWorkflow?.id ?? "");
      setDraft(nextWorkflow ? { ...nextWorkflow, steps: normalizeStepOrder(nextWorkflow.steps) } : null);
      setNewStepAgentId(agentList[0]?.id ?? "");
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, [currentProject?.id]);

  useEffect(() => {
    if (!selectedWorkflowId) {
      setDraft(null);
      return;
    }
    const target = workflows.find((workflow) => workflow.id === selectedWorkflowId) ?? null;
    setDraft(target ? { ...target, steps: normalizeStepOrder(target.steps) } : null);
  }, [selectedWorkflowId, workflows]);

  const agentNameById = useMemo(
    () =>
      Object.fromEntries(agents.map((agent) => [agent.id, agent.name])) as Record<string, string>,
    [agents],
  );
  const groupedWorkflows = useMemo(() => splitWorkflowsByKind(workflows), [workflows]);
  const selectedWorkflowKind = useMemo<WorkflowKind>(() => {
    if (!draft) {
      return "chapter";
    }
    return draft.kind ?? inferWorkflowKind(draft);
  }, [draft]);

  const updateStep = (stepId: string, updater: (step: WorkflowStep) => WorkflowStep) => {
    setDraft((current) => {
      if (!current) {
        return current;
      }
      return {
        ...current,
        steps: normalizeStepOrder(
          current.steps.map((step) => (step.id === stepId ? updater(step) : step)),
        ),
      };
    });
  };

  const deleteStep = (stepId: string) => {
    setDraft((current) => {
      if (!current) {
        return current;
      }
      return {
        ...current,
        steps: normalizeStepOrder(current.steps.filter((step) => step.id !== stepId)),
      };
    });
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!draft || !over || active.id === over.id) {
      return;
    }

    const oldIndex = draft.steps.findIndex((step) => step.id === active.id);
    const newIndex = draft.steps.findIndex((step) => step.id === over.id);
    if (oldIndex < 0 || newIndex < 0) {
      return;
    }

    const moved = arrayMove(draft.steps, oldIndex, newIndex);
    setDraft({
      ...draft,
      steps: normalizeStepOrder(moved),
    });
  };

  const createWorkflow = (kind: WorkflowKind) => {
    if (!currentProject?.id) {
      return;
    }
    const now = new Date().toISOString();
    const kindCount = workflows.filter((workflow) => inferWorkflowKind(workflow) === kind).length + 1;
    const workflow: WorkflowDefinition = {
      id: "",
      projectId: currentProject.id,
      name: kind === "scene" ? `场景工作流 ${kindCount}` : `章节生成工作流 ${kindCount}`,
      description:
        kind === "scene"
          ? "用于场景拆解、过渡与一致性校验。"
          : "用于章节起草、润色与终审。",
      kind,
      steps: [],
      createdAt: now,
      updatedAt: now,
    };
    setSelectedWorkflowId("");
    setDraft(workflow);
    setNotice("已创建未保存的工作流草稿。");
  };

  const addStep = () => {
    if (!draft || !newStepAgentId) {
      return;
    }
    const next = normalizeStepOrder([...draft.steps, newStep(newStepAgentId, draft.steps.length)]);
    setDraft({
      ...draft,
      steps: next,
    });
  };

  const saveWorkflow = async () => {
    if (!currentProject?.id || !draft) {
      return;
    }

    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const saved = await sidecar.workflowSave({
        ...draft,
        projectId: currentProject.id,
        steps: normalizeStepOrder(draft.steps),
      });
      setNotice("工作流已保存。");

      setWorkflows((current) => {
        const existingIndex = current.findIndex((workflow) => workflow.id === saved.id);
        if (existingIndex >= 0) {
          const next = [...current];
          next[existingIndex] = saved;
          return next;
        }
        return [...current, saved];
      });
      setSelectedWorkflowId(saved.id);
      setDraft({ ...saved, steps: normalizeStepOrder(saved.steps) });
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  };

  if (!currentProject?.id) {
    return <p className="text-sm text-muted-foreground">请先打开项目。</p>;
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground">正在加载工作流...</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">工作流编辑器</h2>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 rounded-md border border-border/60 px-2 py-1.5">
            <span className="text-xs text-muted-foreground">场景</span>
            <Select
              value={groupedWorkflows.scene.some((workflow) => workflow.id === selectedWorkflowId) ? selectedWorkflowId : ""}
              onValueChange={(value) => setSelectedWorkflowId(value ?? "")}
            >
              <SelectTrigger className="w-44">
                <SelectValue placeholder="选择场景工作流" />
              </SelectTrigger>
              <SelectContent>
                {groupedWorkflows.scene.map((workflow) => (
                  <SelectItem key={workflow.id} value={workflow.id}>
                    {workflow.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2 rounded-md border border-border/60 px-2 py-1.5">
            <span className="text-xs text-muted-foreground">章节</span>
            <Select
              value={groupedWorkflows.chapter.some((workflow) => workflow.id === selectedWorkflowId) ? selectedWorkflowId : ""}
              onValueChange={(value) => setSelectedWorkflowId(value ?? "")}
            >
              <SelectTrigger className="w-44">
                <SelectValue placeholder="选择章节工作流" />
              </SelectTrigger>
              <SelectContent>
                {groupedWorkflows.chapter.map((workflow) => (
                  <SelectItem key={workflow.id} value={workflow.id}>
                    {workflow.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button variant="outline" onClick={() => createWorkflow("scene")}>
            新建场景流
          </Button>
          <Button variant="outline" onClick={() => createWorkflow("chapter")}>
            新建章节流
          </Button>
          <Button onClick={saveWorkflow} disabled={!draft || saving}>
            {saving ? "保存中..." : "保存工作流"}
          </Button>
        </div>
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

      {!draft ? (
        <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          当前项目没有工作流，点击“新建”开始创建。
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-sm">
            <span className="text-muted-foreground">当前类型</span>
            <Badge variant="outline">{workflowKindLabel(selectedWorkflowKind)}</Badge>
          </div>
          <div className="grid gap-3 rounded-lg border border-border/70 p-3 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="workflow-name">工作流名称</Label>
              <Input
                id="workflow-name"
                value={draft.name}
                onChange={(event) =>
                  setDraft((current) => (current ? { ...current, name: event.target.value } : current))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="workflow-description">描述</Label>
              <Input
                id="workflow-description"
                value={draft.description}
                onChange={(event) =>
                  setDraft((current) =>
                    current ? { ...current, description: event.target.value } : current,
                  )
                }
              />
            </div>
          </div>

          <div className="rounded-lg border border-border/70 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={newStepAgentId}
                onValueChange={(value) => setNewStepAgentId(value ?? "")}
              >
                <SelectTrigger className="w-60">
                  <SelectValue placeholder="选择要添加的智能体" />
                </SelectTrigger>
                <SelectContent>
                  {agents.map((agent) => (
                    <SelectItem key={agent.id} value={agent.id}>
                      {agent.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="outline" onClick={addStep} disabled={!newStepAgentId}>
                添加步骤
              </Button>
            </div>
          </div>

          {draft.steps.length === 0 ? (
            <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              暂无步骤，请先添加智能体步骤。
            </div>
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext
                items={draft.steps.map((step) => step.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="space-y-2">
                  {draft.steps.map((step) => (
                    <SortableStep
                      key={step.id}
                      step={step}
                      agentName={agentNameById[step.agentId] ?? step.agentId}
                      agentSummary={agentSummaries[step.agentId] ?? ""}
                      onChange={(nextStep) => updateStep(step.id, () => nextStep)}
                      onDelete={() => deleteStep(step.id)}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}
        </div>
      )}
    </div>
  );
}
