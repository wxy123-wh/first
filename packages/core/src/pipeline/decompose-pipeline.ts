// Decompose Pipeline — 场景分解管线
// 读取大纲，调用 LLM 生成 scenes.md

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { LLMProvider } from '@lisan/llm';
import type { VectorStore } from '@lisan/rag';
import type { BookConfig } from '../plugin/types.js';
import type { PipelineResult } from './types.js';
import { AgentExecutor } from '../agent/executor.js';
import type { AgentDefinition } from '../agent/types.js';
import { TraceWriter } from '../observability/trace-writer.js';

export interface DecomposePipelineDeps {
  projectRoot: string;
  bookConfig: BookConfig;
  orchestratorProvider: LLMProvider;
  vectorStore: VectorStore | null;
  traceWriter?: TraceWriter;
}

/**
 * Decompose Pipeline
 * 1. 读取大纲文件
 * 2. 从 RAG 检索相关设定
 * 3. 调用编排器 LLM 生成场景树
 * 4. 写入 场景树/scenes.md
 */
export class DecomposePipeline {
  private readonly deps: DecomposePipelineDeps;

  constructor(deps: DecomposePipelineDeps) {
    this.deps = deps;
  }

  async run(arcId: string): Promise<PipelineResult> {
    const startTime = Date.now();
    let totalTokens = 0;
    const outputs: Record<string, string> = {};
    const nl = String.fromCharCode(10);

    const trace = this.deps.traceWriter;
    const traceId = `decompose-${arcId}-${Date.now()}`;
    const emit = (event: Parameters<TraceWriter['createEvent']>[1], payload: Record<string, unknown>) => {
      if (trace) void trace.write(trace.createEvent(traceId, event, payload));
    };

    emit('pipeline_start', { pipeline: 'decompose', arcId });

    // 1. 读取大纲
    const outlinePath = join(this.deps.projectRoot, '大纲', `${arcId}.md`);
    let outline: string;
    try {
      outline = await readFile(outlinePath, 'utf-8');
    } catch {
      // 尝试读取通用大纲
      try {
        outline = await readFile(join(this.deps.projectRoot, '大纲', 'outline.md'), 'utf-8');
      } catch {
        return {
          success: false,
          outputs,
          errors: [{ step: 'read-outline', message: `未找到大纲文件: ${outlinePath}` }],
          stats: { durationMs: Date.now() - startTime, totalTokens: 0 },
        };
      }
    }

    // 2. 从 RAG 检索相关设定
    let settingRefs = '';
    if (this.deps.vectorStore) {
      try {
        const results = await this.deps.vectorStore.search({
          text: outline.slice(0, 500),
          topK: 5,
          mode: 'hybrid',
          filter: { type: ['setting', 'reference'] },
        });
        settingRefs = results.map((r) => r.document.metadata.abstract ?? r.document.content.slice(0, 200)).join(nl);
      } catch {
        // RAG 不可用时继续
      }
    }

    // 3. 调用 LLM 生成场景树
    const agentDef: AgentDefinition = {
      id: 'decompose-agent',
      name: '场景分解 Agent',
      systemPrompt: [
        '你是专业的网文场景分解专家。根据大纲将故事弧线拆分为具体场景。',
        '{{instructions}}',
      ].join(nl),
      model: 'orchestrator',
      timeoutMs: 300_000,
      temperature: 0.5,
    };

    const executor = new AgentExecutor(agentDef, this.deps.orchestratorProvider);
    const output = await executor.run({
      userPrompt: [
        `请将以下大纲分解为场景树，输出 Markdown 格式。`,
        '',
        `弧线 ID: ${arcId}`,
        `类型: ${this.deps.bookConfig.genre}`,
        `爽点类型: ${this.deps.bookConfig.thrillTypes.join(', ')}`,
        '',
        '## 大纲',
        outline,
        settingRefs ? `${nl}## 相关设定${nl}${settingRefs}` : '',
        '',
        '## 输出格式要求',
        '每个章节用 # 第N章 标题 开头，每个场景用 ## 场景N 开头，包含以下字段:',
        '- 标题: 场景标题',
        '- 类型: core/buildup/release/transition/aftermath',
        '- 规模: large/medium/small',
        '- 情绪任务: 该场景的情绪目标',
        '- 爽点类型: 对应的爽点类型（无则留空）',
        '- 阶段: suppress/release/buildup/aftermath/transition',
        '- 角色: 出场角色列表（逗号分隔）',
        '- 地点: 场景发生地',
        '- 事件: 关键事件列表（逗号分隔）',
        '- 允许创角: 是/否',
        '- 创角提示: （如允许创角，描述需要什么样的角色）',
        '- 镜头焦点: 镜头聚焦的角色',
      ].filter(Boolean).join(nl),
      context: {
        instructions: [
          `摄像机规则: ${this.deps.bookConfig.cameraRules}`,
          `主角 ID: ${this.deps.bookConfig.protagonistId}`,
          `字数范围: ${this.deps.bookConfig.chapterWordRange[0]}-${this.deps.bookConfig.chapterWordRange[1]}`,
        ].join(nl),
      },
    });

    totalTokens += output.usage.inputTokens + output.usage.outputTokens;
    outputs['scenes'] = output.content;

    emit('agent_end', { agent: 'decompose-agent', tokens: output.usage });

    // 4. 写入 scenes.md
    const scenesPath = join(this.deps.projectRoot, '场景树', 'scenes.md');
    await writeFile(scenesPath, output.content, 'utf-8');
    outputs['scenesPath'] = scenesPath;

    emit('pipeline_end', { pipeline: 'decompose', arcId, totalTokens });

    return {
      success: true,
      outputs,
      stats: { durationMs: Date.now() - startTime, totalTokens },
    };
  }
}
