// lisan rewrite 命令 — 对接 RewritePipeline

import { Command } from 'commander';
import ora from 'ora';
import { confirm } from '@inquirer/prompts';
import {
  RewritePipeline,
  FileStateManager,
  SqliteEntityGraph,
  TraceWriter,
  loadPlugin,
} from '@lisan/core';
import { createProvider } from '@lisan/llm';
import { loadConfig } from '../config.js';
import { createVectorStore } from './shared.js';
import { join } from 'node:path';

export const rewriteCommand = new Command('rewrite')
  .argument('<chapter>', '章节号')
  .description('改写已有章节')
  .option('--no-git', '跳过 git commit')
  .option('--rerun-pass <n>', '重跑指定 Pass')
  .option('--yes', '跳过确认提示', false)
  .action(async (chapter: string, options: Record<string, unknown>, cmd: Command) => {
    const projectRoot = cmd.parent?.opts().project ?? process.cwd();
    const config = await loadConfig(projectRoot);
    const chapterNum = parseInt(chapter, 10);

    if (isNaN(chapterNum) || chapterNum < 1) {
      console.error('❌ 无效的章节号');
      process.exitCode = 1;
      return;
    }

    if (!options['yes']) {
      const rerunPass = options['rerunPass']
        ? ` (仅重跑 Pass ${options['rerunPass']})`
        : '';
      const ok = await confirm({
        message: `即将改写第 ${chapterNum} 章${rerunPass}，是否继续？`,
        default: true,
      });
      if (!ok) {
        console.log('已取消');
        return;
      }
    }

    const spinner = ora(`改写中: 第 ${chapterNum} 章`).start();

    const orchestratorProvider = createProvider({
      provider: config.llm.orchestrator.provider,
    });
    const workerProvider = createProvider({
      provider: config.llm.worker.provider,
    });

    const stateManager = new FileStateManager(projectRoot);
    const traceWriter = new TraceWriter(projectRoot);
    const plugin = await loadPlugin(config.book.plugin);
    const vectorStore = await createVectorStore(projectRoot, config);

    let entityGraph: SqliteEntityGraph | null = null;
    try {
      entityGraph = new SqliteEntityGraph(join(projectRoot, '.lisan', 'entities.db'));
    } catch {
      // 实体图谱不可用时继续
    }

    await stateManager.updateChapter(chapterNum, { status: 'rewriting' });

    const pipeline = new RewritePipeline({
      projectRoot,
      bookConfig: plugin.bookConfig,
      orchestratorProvider,
      workerProvider,
      vectorStore,
      entityGraph,
      stateManager,
      traceWriter,
      plugin,
      gitCommit: options['git'] !== false ? createGitCommit(projectRoot) : undefined,
    });

    const rerunPass = options['rerunPass']
      ? parseInt(options['rerunPass'] as string, 10)
      : undefined;

    try {
      const result = await pipeline.run(chapterNum, {
        noGit: options['git'] === false,
        rerunPass,
      });

      entityGraph?.close();
      vectorStore?.close();

      if (result.success) {
        const wordCount = result.outputs['final']?.length ?? 0;
        spinner.succeed(
          `第 ${chapterNum} 章改写完成 (${wordCount} 字, ${result.stats.totalTokens} tokens, ${(result.stats.durationMs / 1000).toFixed(1)}s)`,
        );
      } else {
        spinner.fail(`第 ${chapterNum} 章改写失败`);
        console.error(result.errors);
        process.exitCode = 1;
      }
    } catch (err) {
      entityGraph?.close();
      vectorStore?.close();
      spinner.fail(`第 ${chapterNum} 章改写异常`);
      console.error(err);
      process.exitCode = 1;
    }
  });

function createGitCommit(projectRoot: string): (message: string) => Promise<void> {
  return async (message: string) => {
    const { simpleGit } = await import('simple-git');
    const git = simpleGit(projectRoot);
    await git.add('.');
    await git.commit(message);
  };
}
