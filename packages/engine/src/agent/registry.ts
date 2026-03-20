import type { AgentDefinition } from '../types.js';
import type { StoreManager } from '../store/store-manager.js';

export interface RegisterOptions {
  name: string;
  agentMd: string;
  provider: string;
  model: string;
  temperature: number;
  maxTokens?: number;
  promptTemplate: string;
  inputSchema: string[];
}

interface BuiltinPreset extends Omit<AgentDefinition, 'id' | 'createdAt' | 'updatedAt'> {
  summary: string;
}

const BUILTIN_AGENTS: BuiltinPreset[] = [
  {
    name: 'Context Agent',
    category: 'builtin',
    provider: 'anthropic',
    model: 'claude-opus-4-6',
    temperature: 0.3,
    agentMdPath: '.lisan/agents/builtin/context-agent/agent.md',
    promptTemplate: '{{instructions}}',
    inputSchema: ['instructions'],
    summary: '负责整理章节上下文，输出可执行的写作输入包。',
  },
  {
    name: '起草 Agent',
    category: 'builtin',
    provider: 'openai',
    model: 'gpt-4o',
    temperature: 0.85,
    agentMdPath: '.lisan/agents/builtin/draft-agent/agent.md',
    promptTemplate: '{{instructions}}',
    inputSchema: ['instructions'],
    summary: '基于场景与上下文产出章节初稿。',
  },
  {
    name: '体验植入 Pass',
    category: 'builtin',
    provider: 'openai',
    model: 'gpt-4o',
    temperature: 0.8,
    agentMdPath: '.lisan/agents/builtin/rewrite-pass-1/agent.md',
    promptTemplate: '{{instructions}}',
    inputSchema: ['instructions'],
    summary: '第一轮润色，强化读者代入感与现场体验。',
  },
  {
    name: '爽点强化 Pass',
    category: 'builtin',
    provider: 'openai',
    model: 'gpt-4o',
    temperature: 0.8,
    agentMdPath: '.lisan/agents/builtin/rewrite-pass-2/agent.md',
    promptTemplate: '{{instructions}}',
    inputSchema: ['instructions'],
    summary: '第二轮润色，放大爽点密度与释放节奏。',
  },
  {
    name: '节奏张力 Pass',
    category: 'builtin',
    provider: 'openai',
    model: 'gpt-4o',
    temperature: 0.75,
    agentMdPath: '.lisan/agents/builtin/rewrite-pass-3/agent.md',
    promptTemplate: '{{instructions}}',
    inputSchema: ['instructions'],
    summary: '第三轮润色，调整叙事节奏并增强张力。',
  },
  {
    name: '对话博弈 Pass',
    category: 'builtin',
    provider: 'openai',
    model: 'gpt-4o',
    temperature: 0.8,
    agentMdPath: '.lisan/agents/builtin/rewrite-pass-4/agent.md',
    promptTemplate: '{{instructions}}',
    inputSchema: ['instructions'],
    summary: '第四轮润色，优化人物对话与博弈感。',
  },
  {
    name: 'Anti-AI 终检 Pass',
    category: 'builtin',
    provider: 'openai',
    model: 'gpt-4o',
    temperature: 0.7,
    agentMdPath: '.lisan/agents/builtin/rewrite-pass-5/agent.md',
    promptTemplate: '{{instructions}}',
    inputSchema: ['instructions'],
    summary: '第五轮润色，去除机械表达并提升自然度。',
  },
  {
    name: '终审 Agent',
    category: 'builtin',
    provider: 'anthropic',
    model: 'claude-opus-4-6',
    temperature: 0.5,
    agentMdPath: '.lisan/agents/builtin/review-agent/agent.md',
    promptTemplate: '{{instructions}}',
    inputSchema: ['instructions'],
    summary: '对整章进行终审，确保质量与一致性。',
  },
  {
    name: 'Data Agent',
    category: 'builtin',
    provider: 'openai',
    model: 'gpt-4o',
    temperature: 0.3,
    agentMdPath: '.lisan/agents/builtin/data-agent/agent.md',
    promptTemplate: '{{instructions}}',
    inputSchema: ['instructions'],
    summary: '提取实体与摘要信息，沉淀结构化数据。',
  },
  {
    name: '拆解 Agent',
    category: 'builtin',
    provider: 'anthropic',
    model: 'claude-opus-4-6',
    temperature: 0.5,
    agentMdPath: '.lisan/agents/builtin/decompose-agent/agent.md',
    promptTemplate: '{{instructions}}',
    inputSchema: ['instructions'],
    summary: '将大纲段落拆解成结构化场景卡片序列。',
  },
  {
    name: '过渡 Agent',
    category: 'builtin',
    provider: 'openai',
    model: 'gpt-4o',
    temperature: 0.7,
    agentMdPath: '.lisan/agents/builtin/transition-agent/agent.md',
    promptTemplate: '{{instructions}}',
    inputSchema: ['instructions'],
    summary: '补全场景之间的衔接信息，保证叙事连贯。',
  },
  {
    name: '检验 Agent',
    category: 'builtin',
    provider: 'anthropic',
    model: 'claude-opus-4-6',
    temperature: 0.3,
    agentMdPath: '.lisan/agents/builtin/validation-agent/agent.md',
    promptTemplate: '{{instructions}}',
    inputSchema: ['instructions'],
    summary: '校验场景结果与原始大纲是否一致。',
  },
];

function keyFromBuiltinPath(agentMdPath: string): string | null {
  const match = agentMdPath.match(/\.lisan\/agents\/builtin\/([^/]+)\/agent\.md$/);
  return match?.[1] ?? null;
}

function buildBuiltinMd(preset: BuiltinPreset): string {
  return [
    `# ${preset.name}`,
    '',
    preset.summary,
    '',
    '## 职责',
    '',
    '- 根据当前步骤输入稳定地产出结构化结果',
    '- 与前后步骤保持上下文一致',
    '',
    '## 输入',
    '',
    '{{instructions}}',
    '',
  ].join('\n');
}

function shouldBootstrapMd(name: string, md: string): boolean {
  const normalized = md.trim();
  return normalized.length === 0 || normalized === `# ${name}`;
}

export class AgentRegistry {
  constructor(private store: StoreManager) {}

  private findAgent(id: string): AgentDefinition {
    const agents = this.store.getAgents();
    const agent = agents.find((item) => item.id === id);
    if (!agent) {
      throw new Error(`Agent not found: ${id}`);
    }
    return agent;
  }

  register(opts: RegisterOptions): AgentDefinition {
    const agent = this.store.saveAgent({
      id: '',
      name: opts.name,
      category: 'custom',
      provider: opts.provider,
      model: opts.model,
      temperature: opts.temperature,
      maxTokens: opts.maxTokens,
      agentMdPath: `.lisan/agents/custom/${Date.now()}/agent.md`,
      promptTemplate: opts.promptTemplate,
      inputSchema: opts.inputSchema,
      createdAt: '',
      updatedAt: '',
    });
    this.store.saveAgentMd(agent.agentMdPath, opts.agentMd);
    return agent;
  }

  seedBuiltins(): void {
    const existing = this.store.getAgents();
    const presetByKey = new Map(
      BUILTIN_AGENTS.map((preset) => [keyFromBuiltinPath(preset.agentMdPath), preset] as const),
    );
    const keyByName = new Map(
      BUILTIN_AGENTS.map((preset) => [preset.name, keyFromBuiltinPath(preset.agentMdPath)] as const),
    );

    const builtins = existing
      .filter((agent) => agent.category === 'builtin')
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    const seenBuiltinKeys = new Set<string>();
    for (const builtin of builtins) {
      const builtinKey = keyFromBuiltinPath(builtin.agentMdPath) ?? keyByName.get(builtin.name) ?? null;
      if (!builtinKey) {
        continue;
      }
      if (seenBuiltinKeys.has(builtinKey)) {
        this.store.deleteAgent(builtin.id);
        continue;
      }
      seenBuiltinKeys.add(builtinKey);
    }

    const dedupedBuiltins = this.store
      .getAgents()
      .filter((agent) => agent.category === 'builtin')
      .map((agent) => [keyFromBuiltinPath(agent.agentMdPath) ?? keyByName.get(agent.name), agent] as const)
      .filter((entry): entry is [string, AgentDefinition] => Boolean(entry[0]));
    const existingByKey = new Map(dedupedBuiltins);

    for (const preset of BUILTIN_AGENTS) {
      const key = keyFromBuiltinPath(preset.agentMdPath);
      if (!key) {
        continue;
      }

      let agent = existingByKey.get(key);
      if (!agent) {
        agent = this.store.saveAgent({
          id: '',
          ...preset,
          createdAt: '',
          updatedAt: '',
        });
        existingByKey.set(key, agent);
      }

      let currentMd = '';
      try {
        currentMd = this.store.getAgentMd(agent.agentMdPath);
      } catch {
        currentMd = '';
      }
      const presetDefinition = presetByKey.get(key);
      if (presetDefinition && shouldBootstrapMd(agent.name, currentMd)) {
        this.store.saveAgentMd(agent.agentMdPath, buildBuiltinMd(presetDefinition));
      }
    }
  }

  list(): AgentDefinition[] {
    return this.store.getAgents();
  }

  update(id: string, patch: Partial<Pick<AgentDefinition, 'name' | 'provider' | 'model' | 'temperature' | 'maxTokens' | 'promptTemplate' | 'inputSchema'>>): AgentDefinition {
    const agents = this.store.getAgents();
    const agent = agents.find(a => a.id === id);
    if (!agent) throw new Error(`Agent not found: ${id}`);
    if (agent.category === 'builtin') {
      return this.store.saveAgent({
        ...agent,
        provider: patch.provider ?? agent.provider,
        model: patch.model ?? agent.model,
        temperature: patch.temperature ?? agent.temperature,
        maxTokens: 'maxTokens' in patch ? patch.maxTokens : agent.maxTokens,
      });
    }
    return this.store.saveAgent({
      ...agent,
      ...patch,
      maxTokens: 'maxTokens' in patch ? patch.maxTokens : agent.maxTokens,
    });
  }

  duplicate(id: string): AgentDefinition {
    const agents = this.store.getAgents();
    const source = agents.find(a => a.id === id);
    if (!source) throw new Error(`Agent not found: ${id}`);
    const md = this.store.getAgentMd(source.agentMdPath);
    return this.register({
      name: `${source.name} (副本)`,
      agentMd: md,
      provider: source.provider,
      model: source.model,
      temperature: source.temperature,
      maxTokens: source.maxTokens,
      promptTemplate: source.promptTemplate,
      inputSchema: source.inputSchema,
    });
  }

  delete(id: string): void {
    const agent = this.findAgent(id);
    if (agent.category === 'builtin') throw new Error('Cannot delete builtin agent');
    this.store.deleteAgent(id);
  }

  getAgentMd(id: string): string {
    const agent = this.findAgent(id);
    return this.store.getAgentMd(agent.agentMdPath);
  }

  saveAgentMd(id: string, content: string): void {
    const agent = this.findAgent(id);
    if (agent.category === 'builtin') {
      throw new Error('Cannot overwrite builtin agent markdown');
    }
    this.store.saveAgentMd(agent.agentMdPath, content);
  }
}
