// Pass 串行执行器

import type { Pass, PassInput, PassOutput } from './types.js';
import type { ContextPack } from '../context/types.js';

/** Pass 链式执行器 */
export class PassRunner {
  private readonly passes: Pass[];

  constructor(passes: Pass[]) {
    // 按 order 排序
    this.passes = [...passes].sort((a, b) => a.definition.order - b.definition.order);
  }

  /**
   * 串行执行所有 Pass
   * 每个 Pass 的输入是上一个 Pass 的输出
   */
  async runAll(
    initialDraft: string,
    contextPack: ContextPack,
    chapterNumber: number,
    checkerSummary?: string,
  ): Promise<PassOutput[]> {
    const results: PassOutput[] = [];
    let currentDraft = initialDraft;

    for (const pass of this.passes) {
      const input: PassInput = {
        draft: currentDraft,
        contextPack,
        chapterNumber,
        checkerSummary,
      };
      const output = await pass.execute(input);
      results.push(output);
      currentDraft = output.revised;
    }

    return results;
  }

  /**
   * 单 Pass 重跑
   * 读取指定 Pass 的前一个输出作为输入
   */
  async rerunPass(
    passOrder: number,
    previousDraft: string,
    contextPack: ContextPack,
    chapterNumber: number,
    checkerSummary?: string,
  ): Promise<PassOutput> {
    const pass = this.passes.find((p) => p.definition.order === passOrder);
    if (!pass) {
      throw new Error(`Pass order ${passOrder} 不存在`);
    }
    return pass.execute({ draft: previousDraft, contextPack, chapterNumber, checkerSummary });
  }
}

