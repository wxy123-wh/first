// lisan write 命令 — 对接 WritePipeline

import { Command } from 'commander';
import ora from 'ora';
import { confirm } from '@inquirer/prompts';
import {
  preflightCheck,
  WritePipeline,
  FileStateManager,
  SqliteEntityGraph,
  TraceWriter,
  loadPlugin,
} from '@lisan/core';
import { createProvider } from '@lisan/llm';
import { loadConfig } from '../config.js';
import { createVectorStore } from './shared.js';
import { join } from 'node:path';

export const writeCommand = new Command('write')
  .argument('<chapter>', '章节号')
  .description('写作单章')
  .option('--batch <range>', '批量写作（如 1-10）')
  .option('--dry-run', '只生成执行包，不调用 LLM', false)
  .option('--no-git', '跳过 git commit')
  .option('--rerun-pass <n>', '重跑指定 Pass')
  .option('--yes', '跳过确认提示', false)
  .action(async (chapter: string, options: Record<string, unknown>, cmd: Command) => {
    const projectRoot = cmd.parent?.opts().project ?? process.cwd();
    const config = await loadConfig(projectRoot);

    // 批量模式
    if (options['batch']) {
      const [start, end] = (options['batch'] as string).split('-').map(Number);

      if (!options['yes']) {
        const ok = await confirm({
          message: `即将批量写作第 ${start} - ${end} 章，是否继续？`,
          default: true,
        });
        if (!ok) {
          console.log('已取消');
          return;
        }
      }

      console.log(`📝 批量写作: 第 ${start} - ${end} 章`);
      for (let i = start; i <= end; i++) {
        console.log(`\n--- 第 ${i} 章 ---`);
        await runSingleChapter(projectRoot, config, i, options);
      }
      return;
    }

    const chapterNum = parseInt(chapter, 10);

    if (!options['yes'] && !options['dry-run']) {
      const ok = await confirm({
        message: `即将写作第 ${chapterNum} 章，是否继续？`,
        default: true,
      });
      if (!ok) {
        console.log('已取消');
        return;
      }
    }

    await runSingleChapter(projectRoot, config, chapterNum, options);
  });

async function runSingleChapter(
  projectRoot: string,
  config: Awaited<ReturnType<typeof loadConfig>>,
  chapterNumber: number,
  options: Record<string, unknown>,
): Promise<void> {
  // Preflight 校验
  await preflightCheck(projectRoot, chapterNumber);

  const spinner = ora(`写作中: 第 ${chapterNumber} 章`).start();

  // 初始化依赖
  const orchestratorProvider = createProvider({
    provider: config.llm.orchestrator.provider,
  });
  const workerProvider = createProvider({
    provider: config.llm.worker.provider,
  });

  const stateManager = new FileStateManager(projectRoot);
  const traceWriter = new TraceWriter(projectRoot);

  // 实体图谱
  let entityGraph: SqliteEntityGraph | null = null;
  try {
    entityGraph = new SqliteEntityGraph(join(projectRoot, '.lisan', 'entities.db'));
  } catch {
    // 实体图谱不可用时继续
  }

  // RAG
  const vectorStore = await createVectorStore(projectRoot, config);

  // 加载插件获取 BookConfig
  const plugin = await loadPlugin(config.book.plugin);
  const bookConfig = plugin.bookConfig;

  // 更新状态
  await stateManager.updateChapter(chapterNumber, { status: 'drafting' });

  const pipeline = new WritePipeline({
    projectRoot,
    bookConfig,
    orchestratorProvider,
    workerProvider,
    vectorStore,
    entityGraph,
    stateManager,
    traceWriter,
    plugin,
    gitCommit: options['git'] !== false ? createGitCommit(projectRoot) : undefined,
  });

  const rerunPass = options['rerunPass'] ? parseInt(options['rerunPass'] as string, 10) : undefined;

  try {
    const result = await pipeline.run(chapterNumber, {
      dryRun: options['dryRun'] as boolean,
      noGit: options['git'] === false,
      rerunPass,
    });

    // 清理
    entityGraph?.close();
    vectorStore?.close();

    if (result.success) {
      const wordCount = result.outputs['final']?.length ?? 0;
      spinner.succeed(
        `第 ${chapterNumber} 章完成 (${wordCount} 字, ${result.stats.totalTokens} tokens, ${(result.stats.durationMs / 1000).toFixed(1)}s)`,
      );
    } else {
      spinner.fail(`第 ${chapterNumber} 章失败`);
      console.error(result.errors);
      process.exitCode = 1;
    }
  } catch (err) {
    entityGraph?.close();
    vectorStore?.close();
    spinner.fail(`第 ${chapterNumber} 章异常`);
    console.error(err);
    process.exitCode = 1;
  }
}

function createGitCommit(projectRoot: string): (message: string) => Promise<void> {
  return async (message: string) => {
    const { simpleGit } = await import('simple-git');
    const git = simpleGit(projectRoot);
    await git.add('.');
    await git.commit(message);
  };
}
