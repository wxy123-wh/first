import { describe, expect, it } from "vitest";
import { inferWorkflowKind, splitWorkflowsByKind } from "./workflow-kind";
import type { WorkflowDefinition } from "@/types/engine";

function makeWorkflow(overrides: Partial<WorkflowDefinition>): WorkflowDefinition {
  const {
    id = crypto.randomUUID(),
    projectId = "project-1",
    name = "workflow",
    description = "",
    steps = [],
    createdAt = new Date().toISOString(),
    updatedAt = new Date().toISOString(),
    ...rest
  } = overrides;

  return {
    id,
    projectId,
    name,
    description,
    steps,
    createdAt,
    updatedAt,
    ...(rest as Partial<WorkflowDefinition>),
  };
}

describe("workflow-kind util", () => {
  it("prefers explicit kind over heuristic inference", () => {
    const workflow = makeWorkflow({
      name: "章节生成工作流",
      kind: "scene" as WorkflowDefinition["kind"],
    });

    expect(inferWorkflowKind(workflow)).toBe("scene");
  });

  it("falls back to legacy inference when kind is missing", () => {
    const workflow = makeWorkflow({
      name: "场景拆解流程",
      description: "",
    });

    expect(inferWorkflowKind(workflow)).toBe("scene");
  });

  it("splitWorkflowsByKind uses explicit kind when available", () => {
    const sceneWorkflow = makeWorkflow({
      name: "章节流程（旧名）",
      kind: "scene" as WorkflowDefinition["kind"],
    });
    const chapterWorkflow = makeWorkflow({
      name: "场景流程（旧名）",
      kind: "chapter" as WorkflowDefinition["kind"],
    });

    const grouped = splitWorkflowsByKind([sceneWorkflow, chapterWorkflow]);
    expect(grouped.scene.map((workflow) => workflow.id)).toEqual([sceneWorkflow.id]);
    expect(grouped.chapter.map((workflow) => workflow.id)).toEqual([chapterWorkflow.id]);
  });
});
