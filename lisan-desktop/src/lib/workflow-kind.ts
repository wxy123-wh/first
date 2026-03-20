import type { WorkflowDefinition } from "@/types/engine";

export type WorkflowKind = "scene" | "chapter";

const SCENE_HINT = /场景|拆解|decompose/i;
const CHAPTER_HINT = /章节|写作|起草|润色|生成|draft|rewrite|review/i;
const SCENE_STEP_HINT = /decompose|transition|validation|拆解|过渡|检验/i;

export function inferWorkflowKind(
  workflow: Pick<WorkflowDefinition, "name" | "description" | "steps" | "kind">,
): WorkflowKind {
  if (workflow.kind === "scene" || workflow.kind === "chapter") {
    return workflow.kind;
  }
  if (SCENE_HINT.test(workflow.name) || SCENE_HINT.test(workflow.description)) {
    return "scene";
  }
  if (CHAPTER_HINT.test(workflow.name) || CHAPTER_HINT.test(workflow.description)) {
    return "chapter";
  }
  if (workflow.steps.some((step) => SCENE_STEP_HINT.test(step.agentId))) {
    return "scene";
  }
  return "chapter";
}

export function splitWorkflowsByKind(workflows: WorkflowDefinition[]): {
  scene: WorkflowDefinition[];
  chapter: WorkflowDefinition[];
} {
  const scene = workflows.filter((workflow) => inferWorkflowKind(workflow) === "scene");
  const chapter = workflows.filter((workflow) => inferWorkflowKind(workflow) === "chapter");
  return { scene, chapter };
}

export function pickSceneWorkflow(workflows: WorkflowDefinition[]): WorkflowDefinition | null {
  const { scene } = splitWorkflowsByKind(workflows);
  return scene[0] ?? null;
}

export function pickChapterWorkflow(workflows: WorkflowDefinition[]): WorkflowDefinition | null {
  const { chapter } = splitWorkflowsByKind(workflows);
  return chapter[0] ?? null;
}
