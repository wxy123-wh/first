// lisan decompose 命令 — 对接 DecomposePipeline

import { Command } from 'commander';
import ora from 'ora';
import { confirm } from '@inquirer/prompts';
import {
  DecomposePipeline,
  TraceWriter,
  loadPlugin,
} from '@lisan/core';
import { createProvider } from '@lisan/llm';
import { LanceDBStore } from '@lisan/rag';
import { loadConfig } from '../config.js';
import { createEmbeddingProvider, createVectorStore } from './shared.js';
import { join } from 'node:path';

export const decomposeCommand = new Command('decompose')
  .argument('<arc-id>', '弧线 ID（对应 大纲/<arc-id>.md）')
  .description('场景分解（输出 scenes.md）')
  .option('--yes', '跳过确认提示', false)
  .action(async (arcId: string, options: Record<string, unknown>, cmd: Command) => {
    const projectRoot = cmd.parent?.opts().project ?? process.cwd();
    const config = await loadConfig(projectRoot);

    if (!options['yes']) {
      const ok = await confirm({
        message: `即将对弧线 "${arcId}" 执行场景分解，生成 场景树/scenes.md，是否继续？`,
        default: true,
      });
      if (!ok) {
        console.log('已取消');
        return;
      }
    }

    const spinner = ora(`场景分解中: ${arcId}`).start();

    const orchestratorProvider = createProvider({
      provider: config.llm.orchestrator.provider,
    });

    const traceWriter = new TraceWriter(projectRoot);
    const plugin = await loadPlugin(config.book.plugin);

    let vectorStore: LanceDBStore | null = null;
    try {
      vectorStore = await createVectorStore(projectRoot, config);
    } catch {
      // RAG 不可用时继续
    }

    const pipeline = new DecomposePipeline({
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
          `场景分解完成 (${result.stats.totalTokens} tokens, ${(result.stats.durationMs / 1000).toFixed(1)}s)`,
        );
        console.log(`  📄 输出: 场景树/scenes.md`);
      } else {
        spinner.fail('场景分解失败');
        console.error(result.errors);
        process.exitCode = 1;
      }
    } catch (err) {
      vectorStore?.close();
      spinner.fail('场景分解异常');
      console.error(err);
      process.exitCode = 1;
    }
  });
