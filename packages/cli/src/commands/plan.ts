// lisan plan 命令 — 对接 PlanPipeline

import { Command } from 'commander';
import ora from 'ora';
import { confirm } from '@inquirer/prompts';
import {
  PlanPipeline,
  TraceWriter,
  loadPlugin,
} from '@lisan/core';
import { createProvider } from '@lisan/llm';
import { loadConfig } from '../config.js';
import { createVectorStore } from './shared.js';

export const planCommand = new Command('plan')
  .argument('<arc-id>', '弧线 ID')
  .description('章节规划（输出 chapter-plan.md）')
  .option('--yes', '跳过确认提示', false)
  .action(async (arcId: string, options: Record<string, unknown>, cmd: Command) => {
    const projectRoot = cmd.parent?.opts().project ?? process.cwd();
    const config = await loadConfig(projectRoot);

    if (!options['yes']) {
      const ok = await confirm({
        message: `即将对弧线 "${arcId}" 生成章节规划，输出 大纲/chapter-plan.md，是否继续？`,
        default: true,
      });
      if (!ok) {
        console.log('已取消');
        return;
      }
    }

    const spinner = ora(`章节规划中: ${arcId}`).start();

    const orchestratorProvider = createProvider({
      provider: config.llm.orchestrator.provider,
    });

    const traceWriter = new TraceWriter(projectRoot);
    const plugin = await loadPlugin(config.book.plugin);
    const vectorStore = await createVectorStore(projectRoot, config);

    const pipeline = new PlanPipeline({
      projectRoot,
      bookConfig: plugin.bookConfig,
      orchestratorProvider,
      vectorStore,
      traceWriter,
    });

    try {
      const result = await pipeline.run(arcId);
      vectorStore?.close();

      if (result.success) {
        spinner.succeed(
          `章节规划完成 (${result.stats.totalTokens} tokens, ${(result.stats.durationMs / 1000).toFixed(1)}s)`,
        );
        console.log(`  📄 输出: 大纲/chapter-plan.md`);
      } else {
        spinner.fail('章节规划失败');
        console.error(result.errors);
        process.exitCode = 1;
      }
    } catch (err) {
      vectorStore?.close();
      spinner.fail('章节规划异常');
      console.error(err);
      process.exitCode = 1;
    }
  });
