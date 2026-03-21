import type { AgentDefinition, StepConfigOverride, WorkflowDefinition, WorkflowKind, WorkflowStep } from '../types.js';
import type { StoreManager } from '../store/store-manager.js';

const SCENE_NAME_HINT = /场景|拆解|decompose/i;
const CHAPTER_NAME_HINT = /章节|写作|起草|改写|生成|draft|rewrite|review/i;

const SCENE_AGENT_NAMES = new Set(['拆解 Agent', '过渡 Agent', '检验 Agent']);
const CHAPTER_AGENT_NAMES = new Set([
  'Context Agent',
  '起草 Agent',
  '体验植入 Pass',
  '爽点强化 Pass',
  '节奏张力 Pass',
  '对话博弈 Pass',
  'Anti-AI 终检 Pass',
  '终审 Agent',
  'Data Agent',
]);

export function inferWorkflowKind(
  workflow: Pick<WorkflowDefinition, 'name' | 'description' | 'steps' | 'kind'>,
  agentNameById?: Record<string, string>,
): WorkflowKind {
  if (workflow.kind === 'scene' || workflow.kind === 'chapter') {
    return workflow.kind;
  }
  if (SCENE_NAME_HINT.test(workflow.name) || SCENE_NAME_HINT.test(workflow.description)) {
    return 'scene';
  }
  if (CHAPTER_NAME_HINT.test(workflow.name) || CHAPTER_NAME_HINT.test(workflow.description)) {
    return 'chapter';
  }

  if (workflow.steps.length > 0 && agentNameById) {
    const names = workflow.steps
      .map((step) => agentNameById[step.agentId])
      .filter((value): value is string => Boolean(value));
    if (names.some((name) => SCENE_AGENT_NAMES.has(name))) {
      return 'scene';
    }
    if (names.some((name) => CHAPTER_AGENT_NAMES.has(name))) {
      return 'chapter';
    }
  }

  return 'chapter';
}

function buildStepsByNames(
  agentNameOrder: string[],
  agentIdByName: Record<string, string>,
  configByAgentName?: Record<string, StepConfigOverride>,
): WorkflowStep[] {
  const steps: WorkflowStep[] = [];
  for (const agentName of agentNameOrder) {
    const agentId = agentIdByName[agentName];
    if (!agentId) {
      continue;
    }
    const config = configByAgentName?.[agentName];
    steps.push({
      id: '',
      order: steps.length,
      agentId,
      enabled: true,
      config: config ? { ...config } : undefined,
    });
  }
  return steps;
}

function createDefaultSceneWorkflow(projectId: string, agents: AgentDefinition[]): WorkflowDefinition | null {
  const agentIdByName = Object.fromEntries(agents.map((agent) => [agent.name, agent.id])) as Record<string, string>;
  const steps = buildStepsByNames(['拆解 Agent', '过渡 Agent', '检验 Agent'], agentIdByName);
  if (steps.length === 0) {
    return null;
  }

  return {
    id: '',
    projectId,
    name: '默认场景工作流',
    description: '用于将大纲拆解为结构化场景卡片。',
    kind: 'scene',
    steps,
    createdAt: '',
    updatedAt: '',
  };
}

function createDefaultChapterWorkflow(projectId: string, agents: AgentDefinition[]): WorkflowDefinition | null {
  const agentIdByName = Object.fromEntries(agents.map((agent) => [agent.name, agent.id])) as Record<string, string>;
  const steps = buildStepsByNames(
    [
      'Context Agent',
      '起草 Agent',
      '体验植入 Pass',
      '爽点强化 Pass',
      '节奏张力 Pass',
      '对话博弈 Pass',
      'Anti-AI 终检 Pass',
      '终审 Agent',
      'Data Agent',
    ],
    agentIdByName,
    {
      '终审 Agent': { primaryOutput: true },
    },
  );
  if (steps.length === 0) {
    return null;
  }

  return {
    id: '',
    projectId,
    name: '默认章节生成工作流',
    description: '用于章节起草、润色、终审与数据沉淀。',
    kind: 'chapter',
    steps,
    createdAt: '',
    updatedAt: '',
  };
}

export function ensureDefaultWorkflows(
  store: StoreManager,
  projectId: string,
  agents: AgentDefinition[],
): WorkflowDefinition[] {
  const workflows = store.getWorkflows(projectId);
  const agentNameById = Object.fromEntries(agents.map((agent) => [agent.id, agent.name])) as Record<
    string,
    string
  >;
  const hasSceneWorkflow = workflows.some((workflow) => inferWorkflowKind(workflow, agentNameById) === 'scene');
  const hasChapterWorkflow = workflows.some((workflow) => inferWorkflowKind(workflow, agentNameById) === 'chapter');

  if (!hasSceneWorkflow) {
    const workflow = createDefaultSceneWorkflow(projectId, agents);
    if (workflow) {
      store.saveWorkflow(workflow);
    }
  }
  if (!hasChapterWorkflow) {
    const workflow = createDefaultChapterWorkflow(projectId, agents);
    if (workflow) {
      store.saveWorkflow(workflow);
    }
  }

  return store.getWorkflows(projectId);
}
