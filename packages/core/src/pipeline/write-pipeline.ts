// Write Pipeline — 完整写作管线实现

import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { LLMProvider } from '@lisan/llm';
import type { VectorStore } from '@lisan/rag';
import type { BookConfig, LisanPlugin } from '../plugin/types.js';
import type { AgentDefinition } from '../agent/types.js';
import type { Pass, PassDefinition, PassOutput, PipelineResult } from './types.js';
import type { ContextPack } from '../context/types.js';
import type { EntityGraph, Entity } from '../state/entity-graph.js';
import type { StateManager } from '../state/types.js';
import { AgentExecutor } from '../agent/executor.js';
import { PassRunner } from './pass-runner.js';
import { ContextAgent, type ContextAgentDeps } from '../context/context-agent.js';
import { TraceWriter } from '../observability/trace-writer.js';
import { checkDraft } from '../checker/post-write-checker.js';
import { parseDraftOutput } from './draft-parser.js';
import type { SettlementData } from '../truth/types.js';
import { TruthManager } from '../truth/truth-manager.js';

export interface WritePipelineDeps {
  projectRoot: string;
  bookConfig: BookConfig;
  orchestratorProvider: LLMProvider;
  workerProvider: LLMProvider;
  vectorStore: VectorStore | null;
  entityGraph: EntityGraph | null;
  stateManager: StateManager;
  traceWriter?: TraceWriter;
  /** 插件实例，用于 Pass 覆盖 */
  plugin?: LisanPlugin;
  /** simple-git commit 函数，外部注入 */
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
 * Write Pipeline
 * Step 1: Context Agent — 组装执行包
 * Step 2: Draft Agent — 起草初稿
 * Step 2.5: Post-Write Checker — 确定性规则检查
 * Step 3: 5 Pass 改写链（注入 checker 违规清单）
 * Step 4: Review Agent — 终审
 * Step 5: Data Agent — 实体提取 + 摘要 + 嵌入
 * Step 6: Git commit
 */
export class WritePipeline {
  private readonly deps: WritePipelineDeps;

  constructor(deps: WritePipelineDeps) {
    this.deps = deps;
  }

  async run(chapterNumber: number, options?: { rerunPass?: number; dryRun?: boolean; noGit?: boolean }): Promise<PipelineResult> {
    const startTime = Date.now();
    let totalTokens = 0;
    const outputs: Record<string, string> = {};

    const trace = this.deps.traceWriter;
    const traceId = `write-ch${chapterNumber}-${Date.now()}`;
    const emit = (event: Parameters<TraceWriter['createEvent']>[1], payload: Record<string, unknown>) => {
      if (trace) void trace.write(trace.createEvent(traceId, event, payload));
    };
    const agentDefs = new Map(this.deps.bookConfig.agentDefinitions.map((d) => [d.id, d]));

    // --- Step 1: Context Agent ---
    emit('pipeline_start', { chapter: chapterNumber });

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

    if (options?.dryRun) {
      return {
        success: true,
        outputs,
        stats: { durationMs: Date.now() - startTime, totalTokens: 0 },
      };
    }

    // --- Step 2: Draft Agent (三阶段输出) ---
    const draftAgentDef = agentDefs.get('draft-agent');
    if (!draftAgentDef) throw new Error('缺少 draft-agent 定义');

    const draftExecutor = new AgentExecutor(draftAgentDef, this.deps.workerProvider);
    const nl = String.fromCharCode(10);
    const draftOutput = await draftExecutor.run({
      userPrompt: [
        `请根据以下执行包起草第${chapterNumber}章正文。`,
        '',
        '=== 阶段一：写前自检（PRE_WRITE_CHECK） ===',
        '在动笔前，请先输出以下检查块（用 ```pre-check 围栏标记）：',
        '1. 上下文确认：本章场景列表、情绪任务、爽点类型',
        '2. 世界状态核对：主角位置/状态/物品（对照真相文件）',
        '3. 信息边界检查：出场角色各自知道/不知道什么',
        '4. 伏笔检查：本章需回收/新埋的伏笔',
        '5. 风险扫描：可能出错的点',
        '',
        '=== 阶段二：正文 ===',
        '（用 ```chapter 围栏标记）',
        '',
        `章节标题: ${contextPack.chapterTitle}`,
        `情绪任务: ${contextPack.emotionTask}`,
        `情绪曲线: ${contextPack.emotionCurve}`,
        `爽点类型: ${contextPack.thrillType}`,
        `章末钩子: ${contextPack.endHook}`,
        '',
        `场景数: ${contextPack.scenes.length}`,
        ...contextPack.scenes.map((s, i) => `场景${i + 1}: ${s.title} (${s.type}, ${s.emotionTask})`),
        '',
        contextPack.prevChapterTail ? `上章尾部:${nl}${contextPack.prevChapterTail}` : '',
        contextPack.settingRefs ? `相关设定:${nl}${contextPack.settingRefs}` : '',
        contextPack.characterCards ? `角色卡:${nl}${contextPack.characterCards}` : '',
        contextPack.truthSummary ? `${nl}${contextPack.truthSummary}` : '',
        '',
        '=== 阶段三：写后结算（POST_SETTLEMENT） ===',
        '正文写完后，请追加结算块（用 ```settlement 围栏标记，JSON 格式）：',
        '{',
        '  "characterInteractions": [{characters: ["A", "B"], type: "first_meet|info_gain|relation_change", description: "..."}],',
        '  "hookChanges": [{action: "plant|resolve", hookId: "...", description: "...", expectedResolution: 章节号}],',
        '  "worldStateChanges": [{category: "location|item|body|faction", description: "..."}],',
        '  "upgradeEvents": [{type: "ability|skill|resource", description: "..."}]',
        '}',
      ].filter(Boolean).join(nl),
      context: {
        instructions: [
          `摄像机规则: ${this.deps.bookConfig.cameraRules}`,
          `感官优先级: ${this.deps.bookConfig.sensorPriority.join(' > ')}`,
          `字数范围: ${this.deps.bookConfig.chapterWordRange[0]}-${this.deps.bookConfig.chapterWordRange[1]}`,
        ].join(nl),
      },
    });

    totalTokens += draftOutput.usage.inputTokens + draftOutput.usage.outputTokens;
    outputs['draft-raw'] = draftOutput.content;
    emit('agent_end', { agent: 'draft-agent', tokens: draftOutput.usage });

    // 解析三阶段输出
    const parsed = parseDraftOutput(draftOutput.content);
    outputs['pre-check'] = parsed.preCheck;
    outputs['draft'] = parsed.chapter;
    const settlement: SettlementData = parsed.settlement;

    // --- Step 2.5: Post-Write Checker ---
    const checkResult = checkDraft(parsed.chapter);
    if (checkResult.summary) {
      outputs['checker'] = checkResult.summary;
    }
    emit('checker_end', {
      errors: checkResult.errors.length,
      warnings: checkResult.warnings.length,
    });

    // --- Step 3: 5 Pass 改写链 ---
    let currentDraft = parsed.chapter;

    if (options?.rerunPass) {
      // 单 Pass 重跑
      const passes = this.buildPasses(agentDefs);
      const runner = new PassRunner(passes);
      const passOutput = await runner.rerunPass(options.rerunPass, currentDraft, contextPack, chapterNumber, checkResult.summary || undefined);
      totalTokens += passOutput.agentOutput.usage.inputTokens + passOutput.agentOutput.usage.outputTokens;
      currentDraft = passOutput.revised;
      outputs[`pass-${options.rerunPass}`] = passOutput.revised;
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
            `终审第${chapterNumber}章。检查:`,
            `1. 场景完成度: 所有${contextPack.scenes.length}个场景是否都已覆盖`,
            `2. 情绪任务: ${contextPack.emotionTask} 是否达成`,
            `3. 章末钩子: ${contextPack.endHook} 是否设置`,
            `4. 摄像机规则: ${this.deps.bookConfig.cameraRules}`,
            `5. Anti-AI 词汇检查: ${this.deps.bookConfig.antiAiWordlist.join(', ')}`,
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

    // --- Step 5: Data Agent — 实体提取 + 摘要 + 真相文件更新 ---
    const dataAgentDef = agentDefs.get('data-agent');
    if (dataAgentDef) {
      await this.runDataAgent(dataAgentDef, currentDraft, chapterNumber, contextPack, settlement);
    }

    // 写入正文文件
    const chapterPath = join(
      this.deps.projectRoot,
      '正文',
      `chapter-${String(chapterNumber).padStart(3, '0')}.md`,
    );
    await writeFile(chapterPath, currentDraft, 'utf-8');
    outputs['final'] = currentDraft;

    // 更新状态
    await this.deps.stateManager.updateChapter(chapterNumber, {
      status: 'done',
      filePath: chapterPath,
      wordCount: currentDraft.length,
      completedAt: new Date().toISOString(),
    });

    // --- Step 6: Git commit ---
    if (!options?.noGit && this.deps.gitCommit) {
      try {
        await this.deps.gitCommit(`feat: 第${chapterNumber}章完成`);
        const state = await this.deps.stateManager.load();
        const chapter = state.chapters[chapterNumber];
        if (chapter) {
          await this.deps.stateManager.updateChapter(chapterNumber, {
            gitCommit: 'latest',
          });
        }
      } catch {
        // git commit 失败不阻塞管线
      }
    }

    emit('pipeline_end', { chapter: chapterNumber, totalTokens });

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
      // 插件覆盖：createPass 返回非 null 时替换默认实现
      const pluginPass = this.deps.plugin?.createPass?.(passDef.id) ?? null;
      if (pluginPass) return pluginPass;

      const agentDef = agentDefs.get(passDef.agentId);
      if (!agentDef) throw new Error(`缺少 Agent 定义: ${passDef.agentId}`);
      return new AgentPass(passDef, agentDef, this.deps.workerProvider, this.deps.bookConfig);
    });
  }

  /** Data Agent: 实体提取 + 章节摘要 + 向量嵌入 + 真相文件更新 */
  private async runDataAgent(
    agentDef: AgentDefinition,
    finalDraft: string,
    chapterNumber: number,
    contextPack: ContextPack,
    settlement: SettlementData,
  ): Promise<void> {
    const nl = String.fromCharCode(10);
    const executor = new AgentExecutor(agentDef, this.deps.workerProvider);

    const output = await executor.run({
      userPrompt: finalDraft,
      context: {
        instructions: [
          `分析第${chapterNumber}章正文，提取:`,
          '1. 新出现的实体（角色/地点/物品/事件）',
          '2. 章节摘要（200字以内）',
          '3. 关键情节点',
          '',
          '以 JSON 格式返回:',
          '{"entities":[{"name","type","metadata":{}}],"summary":"...","keyPoints":["..."]}',
        ].join(nl),
      },
    });

    try {
      const data = extractJson(output.content);
      if (!data) return;

      // 写入实体图谱
      if (this.deps.entityGraph && Array.isArray(data.entities)) {
        for (const raw of data.entities) {
          const entity: Entity = {
            id: `data-${chapterNumber}-${(raw as Record<string, string>).name}-${Date.now()}`,
            name: (raw as Record<string, string>).name ?? '',
            type: ((raw as Record<string, string>).type as Entity['type']) ?? 'event',
            metadata: (raw as Record<string, unknown>).metadata as Record<string, unknown> ?? {},
            createdInChapter: chapterNumber,
            persistence: 'arc',
          };
          try {
            this.deps.entityGraph.create(entity);
          } catch {
            // 重复 id 等错误忽略
          }
        }
      }

      // 写入 RAG
      if (this.deps.vectorStore && typeof data.summary === 'string') {
        await this.deps.vectorStore.upsert([{
          id: `chapter-${chapterNumber}`,
          content: finalDraft,
          metadata: {
            source: `chapter-${String(chapterNumber).padStart(3, '0')}.md`,
            type: 'chapter',
            abstract: data.summary,
            overview: Array.isArray(data.keyPoints) ? (data.keyPoints as string[]).join(nl) : '',
          },
        }]);
      }
    } catch {
      // 解析失败不阻塞管线
    }

    // 更新真相文件
    try {
      const truthManager = new TruthManager(this.deps.projectRoot);
      await truthManager.applySettlement(settlement, chapterNumber);
      await truthManager.markStaleHooks(chapterNumber);
    } catch {
      // 真相文件更新失败不阻塞管线
    }
  }
}

/** 从文本中提取 JSON */
function extractJson(text: string): Record<string, unknown> | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]) as Record<string, unknown>;
  } catch {
    return null;
  }
}
