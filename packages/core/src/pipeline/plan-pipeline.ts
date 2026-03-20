// Plan Pipeline — 章节规划管线
// 读取场景树 + 设定，调用 LLM 生成 chapter-plan.md

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { LLMProvider } from '@lisan/llm';
import type { VectorStore } from '@lisan/rag';
import type { BookConfig } from '../plugin/types.js';
import type { PipelineResult } from './types.js';
import { AgentExecutor } from '../agent/executor.js';
import type { AgentDefinition } from '../agent/types.js';
import { TraceWriter } from '../observability/trace-writer.js';

export interface PlanPipelineDeps {
  projectRoot: string;
  bookConfig: BookConfig;
  orchestratorProvider: LLMProvider;
  vectorStore: VectorStore | null;
  traceWriter?: TraceWriter;
}

/**
 * Plan Pipeline
 * 1. 读取场景树 scenes.md
 * 2. 从 RAG 检索相关设定
 * 3. 调用编排器 LLM 生成章节规划
 * 4. 写入 大纲/chapter-plan.md
 */
export class PlanPipeline {
  private readonly deps: PlanPipelineDeps;

  constructor(deps: PlanPipelineDeps) {
    this.deps = deps;
  }

  async run(arcId: string): Promise<PipelineResult> {
    const startTime = Date.now();
    let totalTokens = 0;
    const outputs: Record<string, string> = {};
    const nl = String.fromCharCode(10);

    const trace = this.deps.traceWriter;
    const traceId = `plan-${arcId}-${Date.now()}`;
    const emit = (event: Parameters<TraceWriter['createEvent']>[1], payload: Record<string, unknown>) => {
      if (trace) void trace.write(trace.createEvent(traceId, event, payload));
    };

    emit('pipeline_start', { pipeline: 'plan', arcId });

    // 1. 读取场景树
    const scenesPath = join(this.deps.projectRoot, '场景树', 'scenes.md');
    let scenes: string;
    try {
      scenes = await readFile(scenesPath, 'utf-8');
    } catch {
      return {
        success: false,
        outputs,
        errors: [{ step: 'read-scenes', message: `未找到场景树文件: ${scenesPath}` }],
        stats: { durationMs: Date.now() - startTime, totalTokens: 0 },
      };
    }

    // 2. 读取大纲（如存在，作为补充参考）
    let outline = '';
    const arcOutlinePath = join(this.deps.projectRoot, '大纲', `${arcId}.md`);
    const canonicalOutlinePath = join(this.deps.projectRoot, '大纲', 'arc-1.md');
    const legacyOutlinePath = join(this.deps.projectRoot, 'outline.md');
    try {
      outline = await readFile(arcOutlinePath, 'utf-8');
    } catch {
      try {
        outline = await readFile(canonicalOutlinePath, 'utf-8');
      } catch {
        try {
          outline = await readFile(legacyOutlinePath, 'utf-8');
        } catch {
          // 大纲不存在时继续，场景树是主要输入
        }
      }
    }

    // 3. 从 RAG 检索相关设定
    let settingRefs = '';
    if (this.deps.vectorStore) {
      try {
        const results = await this.deps.vectorStore.search({
          text: scenes.slice(0, 500),
          topK: 5,
          mode: 'hybrid',
          filter: { type: ['setting', 'reference'] },
        });
        settingRefs = results.map((r) => r.document.metadata.abstract ?? r.document.content.slice(0, 200)).join(nl);
      } catch {
        // RAG 不可用时继续
      }
    }

    // 4. 调用 LLM 生成章节规划
    const agentDef: AgentDefinition = {
      id: 'plan-agent',
      name: '章节规划 Agent',
      systemPrompt: [
        '你是专业的网文章节规划专家。根据场景树为每个章节生成详细的执行规划。',
        '{{instructions}}',
      ].join(nl),
      model: 'orchestrator',
      timeoutMs: 300_000,
      temperature: 0.5,
    };

    const executor = new AgentExecutor(agentDef, this.deps.orchestratorProvider);
    const output = await executor.run({
      userPrompt: [
        '请根据以下场景树，为每个章节生成详细的章节规划。',
        '',
        `弧线 ID: ${arcId}`,
        `类型: ${this.deps.bookConfig.genre}`,
        `爽点类型: ${this.deps.bookConfig.thrillTypes.join(', ')}`,
        '',
        '## 场景树',
        scenes,
        outline ? `${nl}## 大纲参考${nl}${outline}` : '',
        settingRefs ? `${nl}## 相关设定${nl}${settingRefs}` : '',
        '',
        '## 输出格式要求',
        '每个章节用 # 第N章 标题 开头，包含以下字段:',
        '- 标题: 章节标题',
        '- 情绪任务: 本章的核心情绪目标',
        '- 情绪曲线: 情绪走势（如 低-低-高）',
        '- 爽点类型: 对应的爽点类型（无则留空）',
        '- 章末钩子: 章节结尾的悬念设置',
        '- 核心冲突: 本章的主要矛盾',
        '- 节奏控制: 快/中/慢 的节奏安排',
        `- 字数目标: ${this.deps.bookConfig.chapterWordRange[0]}-${this.deps.bookConfig.chapterWordRange[1]}`,
      ].filter(Boolean).join(nl),
      context: {
        instructions: [
          `摄像机规则: ${this.deps.bookConfig.cameraRules}`,
          `主角 ID: ${this.deps.bookConfig.protagonistId}`,
          `感官优先级: ${this.deps.bookConfig.sensorPriority.join(' > ')}`,
          `字数范围: ${this.deps.bookConfig.chapterWordRange[0]}-${this.deps.bookConfig.chapterWordRange[1]}`,
        ].join(nl),
      },
    });

    totalTokens += output.usage.inputTokens + output.usage.outputTokens;
    outputs['chapterPlan'] = output.content;

    emit('agent_end', { agent: 'plan-agent', tokens: output.usage });

    // 5. 写入 chapter-plan.md
    const planPath = join(this.deps.projectRoot, '大纲', 'chapter-plan.md');
    await writeFile(planPath, output.content, 'utf-8');
    outputs['planPath'] = planPath;

    emit('pipeline_end', { pipeline: 'plan', arcId, totalTokens });

    return {
      success: true,
      outputs,
      stats: { durationMs: Date.now() - startTime, totalTokens },
    };
  }
}
