// Rewrite Pipeline — 章节改写管线
// 读取已完成章节，通过 Pass 链改写，写回文件

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { LLMProvider } from '@lisan/llm';
import type { VectorStore } from '@lisan/rag';
import type { BookConfig, LisanPlugin } from '../plugin/types.js';
import type { AgentDefinition } from '../agent/types.js';
import type { Pass, PassDefinition, PassOutput, PipelineResult } from './types.js';
import type { ContextPack } from '../context/types.js';
import type { EntityGraph } from '../state/entity-graph.js';
import type { StateManager } from '../state/types.js';
import { AgentExecutor } from '../agent/executor.js';
import { PassRunner } from './pass-runner.js';
import { ContextAgent, type ContextAgentDeps } from '../context/context-agent.js';
import { TraceWriter } from '../observability/trace-writer.js';
import { checkDraft } from '../checker/post-write-checker.js';

export interface RewritePipelineDeps {
  projectRoot: string;
  bookConfig: BookConfig;
  orchestratorProvider: LLMProvider;
  workerProvider: LLMProvider;
  vectorStore: VectorStore | null;
  entityGraph: EntityGraph | null;
  stateManager: StateManager;
  traceWriter?: TraceWriter;
  plugin?: LisanPlugin;
  gitCommit?: (message: string) => Promise<void>;
}

/** 默认 Pass 实现：用 AgentExecutor 执行 */
class AgentPass implements Pass {
  readonly definition: PassDefinition;
  private readonly executor: AgentExecutor;
  private readonly bookConfig: BookConfig;

  constructor(definition: PassDefinition, agentDef: AgentDefinition, provider: LLMProvider, bookConfig: BookConfig) {
    this.definition = definition;
    this.executor = new AgentExecutor(agentDef, provider);
    this.bookConfig = bookConfig;
  }

  async execute(input: { draft: string; contextPack: ContextPack; chapterNumber: number; checkerSummary?: string }): Promise<PassOutput> {
    const nl = String.fromCharCode(10);
    const instructionLines = [
      `章节: 第${input.chapterNumber}章 ${input.contextPack.chapterTitle}`,
      `情绪任务: ${input.contextPack.emotionTask}`,
      `爽点类型: ${input.contextPack.thrillType}`,
      `摄像机规则: ${this.bookConfig.cameraRules}`,
      `感官优先级: ${this.bookConfig.sensorPriority.join(' > ')}`,
      `Anti-AI 词汇: ${this.bookConfig.antiAiWordlist.join(', ')}`,
      `字数范围: ${this.bookConfig.chapterWordRange[0]}-${this.bookConfig.chapterWordRange[1]}`,
    ];
    if (input.checkerSummary) {
      instructionLines.push('', input.checkerSummary);
    }
    const output = await this.executor.run({
      userPrompt: input.draft,
      context: {
        instructions: instructionLines.join(nl),
      },
    });

    return {
      revised: output.content,
      agentOutput: output,
    };
  }
}

/**
 * Rewrite Pipeline
 * Step 1: Context Agent — 组装执行包
 * Step 2: 读取已有正文
 * Step 3: Pass 改写链
 * Step 4: Review Agent — 终审
 * Step 5: 写回文件 + 更新状态
 * Step 6: Git commit
 */
export class RewritePipeline {
  private readonly deps: RewritePipelineDeps;

  constructor(deps: RewritePipelineDeps) {
    this.deps = deps;
  }

  async run(chapterNumber: number, options?: { rerunPass?: number; noGit?: boolean }): Promise<PipelineResult> {
    const startTime = Date.now();
    let totalTokens = 0;
    const outputs: Record<string, string> = {};
    const nl = String.fromCharCode(10);

    const trace = this.deps.traceWriter;
    const traceId = `rewrite-ch${chapterNumber}-${Date.now()}`;
    const emit = (event: Parameters<TraceWriter['createEvent']>[1], payload: Record<string, unknown>) => {
      if (trace) void trace.write(trace.createEvent(traceId, event, payload));
    };

    const agentDefs = new Map(this.deps.bookConfig.agentDefinitions.map((d) => [d.id, d]));

    emit('pipeline_start', { pipeline: 'rewrite', chapter: chapterNumber });

    // --- Step 1: Context Agent ---
    const contextAgentDef = agentDefs.get('context-agent');
    if (!contextAgentDef) throw new Error('缺少 context-agent 定义');

    const contextAgentDeps: ContextAgentDeps = {
      projectRoot: this.deps.projectRoot,
      bookConfig: this.deps.bookConfig,
      provider: this.deps.orchestratorProvider,
      vectorStore: this.deps.vectorStore,
      entityGraph: this.deps.entityGraph,
      agentDefinition: contextAgentDef,
    };

    const contextAgent = new ContextAgent(contextAgentDeps);
    const contextPack = await contextAgent.buildContextPack(chapterNumber);
    outputs['contextPack'] = JSON.stringify(contextPack, null, 2);

    emit('agent_end', { agent: 'context-agent', chapter: chapterNumber });

    // --- Step 2: 读取已有正文 ---
    const chapterPath = join(
      this.deps.projectRoot,
      '正文',
      `chapter-${String(chapterNumber).padStart(3, '0')}.md`,
    );

    let currentDraft: string;
    try {
      currentDraft = await readFile(chapterPath, 'utf-8');
    } catch {
      return {
        success: false,
        outputs,
        errors: [{ step: 'read-chapter', message: `未找到章节文件: ${chapterPath}，请先执行 write 管线` }],
        stats: { durationMs: Date.now() - startTime, totalTokens: 0 },
      };
    }

    outputs['original'] = currentDraft;

    // --- Step 2.5: Post-Write Checker ---
    const checkResult = checkDraft(currentDraft);
    if (checkResult.summary) {
      outputs['checker'] = checkResult.summary;
    }
    emit('checker_end', {
      errors: checkResult.errors.length,
      warnings: checkResult.warnings.length,
    });

    // --- Step 3: Pass 改写链 ---
    if (options?.rerunPass) {
      const passes = this.buildPasses(agentDefs);
      const runner = new PassRunner(passes);
      const passOutput = await runner.rerunPass(options.rerunPass, currentDraft, contextPack, chapterNumber, checkResult.summary || undefined);
      totalTokens += passOutput.agentOutput.usage.inputTokens + passOutput.agentOutput.usage.outputTokens;
      currentDraft = passOutput.revised;
      outputs[`pass-${options.rerunPass}`] = passOutput.revised;

      emit('pass_end', { pass: options.rerunPass, tokens: passOutput.agentOutput.usage });
    } else {
      const passes = this.buildPasses(agentDefs);
      const runner = new PassRunner(passes);
      const passOutputs = await runner.runAll(currentDraft, contextPack, chapterNumber, checkResult.summary || undefined);

      for (let i = 0; i < passOutputs.length; i++) {
        const po = passOutputs[i];
        totalTokens += po.agentOutput.usage.inputTokens + po.agentOutput.usage.outputTokens;
        outputs[`pass-${i + 1}`] = po.revised;
        emit('pass_end', { pass: i + 1, tokens: po.agentOutput.usage });
      }
      currentDraft = passOutputs[passOutputs.length - 1].revised;
    }

    // --- Step 4: Review Agent ---
    const reviewAgentDef = agentDefs.get('review-agent');
    if (reviewAgentDef) {
      const reviewExecutor = new AgentExecutor(reviewAgentDef, this.deps.orchestratorProvider);
      const reviewOutput = await reviewExecutor.run({
        userPrompt: currentDraft,
        context: {
          instructions: [
            `终审改写后的第${chapterNumber}章。检查:`,
            `1. 场景完成度: 所有${contextPack.scenes.length}个场景是否都已覆盖`,
            `2. 情绪任务: ${contextPack.emotionTask} 是否达成`,
            `3. 章末钩子: ${contextPack.endHook} 是否设置`,
            `4. 摄像机规则: ${this.deps.bookConfig.cameraRules}`,
            `5. Anti-AI 词汇检查: ${this.deps.bookConfig.antiAiWordlist.join(', ')}`,
            `6. 改写质量: 与原稿相比是否有实质性提升`,
            '',
            '如有问题请直接修复并输出完整正文。如无问题则原样输出。',
          ].join(nl),
        },
      });
      totalTokens += reviewOutput.usage.inputTokens + reviewOutput.usage.outputTokens;
      currentDraft = reviewOutput.content;
      outputs['review'] = reviewOutput.content;
      emit('agent_end', { agent: 'review-agent', tokens: reviewOutput.usage });
    }

    // --- Step 5: 写回文件 + 更新状态 ---
    await writeFile(chapterPath, currentDraft, 'utf-8');
    outputs['final'] = currentDraft;

    await this.deps.stateManager.updateChapter(chapterNumber, {
      status: 'done',
      filePath: chapterPath,
      wordCount: currentDraft.length,
      completedAt: new Date().toISOString(),
    });

    // --- Step 6: Git commit ---
    if (!options?.noGit && this.deps.gitCommit) {
      try {
        await this.deps.gitCommit(`refactor: 第${chapterNumber}章改写完成`);
        await this.deps.stateManager.updateChapter(chapterNumber, {
          gitCommit: 'latest',
        });
      } catch {
        // git commit 失败不阻塞管线
      }
    }

    emit('pipeline_end', { pipeline: 'rewrite', chapter: chapterNumber, totalTokens });

    return {
      success: true,
      outputs,
      stats: {
        durationMs: Date.now() - startTime,
        totalTokens,
      },
    };
  }

  /** 构建 Pass 实例列表（插件可覆盖） */
  private buildPasses(agentDefs: Map<string, AgentDefinition>): Pass[] {
    return this.deps.bookConfig.passDefinitions.map((passDef) => {
      const pluginPass = this.deps.plugin?.createPass?.(passDef.id) ?? null;
      if (pluginPass) return pluginPass;

      const agentDef = agentDefs.get(passDef.agentId);
      if (!agentDef) throw new Error(`缺少 Agent 定义: ${passDef.agentId}`);
      return new AgentPass(passDef, agentDef, this.deps.workerProvider, this.deps.bookConfig);
    });
  }
}
