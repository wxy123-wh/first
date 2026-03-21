// lisan sync 命令 — 手动触发数据同步（embedding + git）

import { Command } from 'commander';
import ora from 'ora';
import { confirm } from '@inquirer/prompts';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { loadConfig } from '../config.js';
import { createVectorStore } from './shared.js';
import {
  collectSyncMarkdownFiles,
  inferDocumentType,
  type Document,
} from '@lisan/rag';

async function migrateLegacyOutlineIfNeeded(projectRoot: string): Promise<void> {
  const canonicalPath = join(projectRoot, '大纲', 'arc-1.md');
  try {
    await readFile(canonicalPath, 'utf-8');
    return;
  } catch {
    // continue
  }

  const legacyPath = join(projectRoot, 'outline.md');
  try {
    const legacyContent = await readFile(legacyPath, 'utf-8');
    await mkdir(join(projectRoot, '大纲'), { recursive: true });
    await writeFile(canonicalPath, legacyContent, 'utf-8');
    await rm(legacyPath, { force: true });
  } catch {
    // legacy file does not exist or cannot be migrated; keep sync process running
  }
}

export const syncCommand = new Command('sync')
  .description('手动触发数据同步（embedding + git）')
  .option('--no-git', '跳过 git commit')
  .option('--yes', '跳过确认提示', false)
  .action(async (options: Record<string, unknown>, cmd: Command) => {
    const projectRoot = cmd.parent?.opts().project ?? process.cwd();
    const config = await loadConfig(projectRoot);
    await migrateLegacyOutlineIfNeeded(projectRoot);

    const allFiles = await collectSyncMarkdownFiles(projectRoot);

    if (allFiles.length === 0) {
      console.log('⚠️  未找到需要同步的 Markdown 文件');
      return;
    }

    if (!options['yes']) {
      const ok = await confirm({
        message: `将同步 ${allFiles.length} 个文件到向量数据库，是否继续？`,
        default: true,
      });
      if (!ok) {
        console.log('已取消');
        return;
      }
    }

    // 1. Embedding 同步
    const spinner = ora(`同步 embedding: 0/${allFiles.length}`).start();

    const vectorStore = await createVectorStore(projectRoot, config);
    if (!vectorStore) {
      spinner.fail('向量数据库初始化失败，请检查 embedding 配置');
      process.exitCode = 1;
      return;
    }

    try {
      // 分批处理，每批 10 个文件
      const batchSize = 10;
      let processed = 0;

      for (let i = 0; i < allFiles.length; i += batchSize) {
        const batch = allFiles.slice(i, i + batchSize);
        const docs: Document[] = [];

        for (const filePath of batch) {
          const content = await readFile(filePath, 'utf-8');
          const rel = relative(projectRoot, filePath).replace(/\\\\/g, '/');
          const docType = inferDocumentType(filePath, projectRoot);

          // 提取首行作为摘要
          const firstLine = content.split('\r\n')[0]?.replace(/^#+\\s*/, '').trim() ?? '';

          docs.push({
            id: rel,
            content,
            metadata: {
              source: rel,
              type: docType,
              abstract: firstLine.slice(0, 200),
            },
          });
        }

        await vectorStore.upsert(docs);
        processed += batch.length;
        spinner.text = `同步 embedding: ${processed}/${allFiles.length}`;
      }

      vectorStore.close();
      spinner.succeed(`embedding 同步完成: ${allFiles.length} 个文件`);
    } catch (err) {
      vectorStore.close();
      spinner.fail('embedding 同步失败');
      console.error(err);
      process.exitCode = 1;
      return;
    }

    // 2. Git commit
    if (options['git'] !== false) {
      const gitSpinner = ora('Git 提交中').start();
      try {
        const { simpleGit } = await import('simple-git');
        const git = simpleGit(projectRoot);
        await git.add('.');
        const status = await git.status();
        if (status.staged.length > 0) {
          await git.commit(`sync: 同步 ${allFiles.length} 个文件`);
          gitSpinner.succeed('Git 提交完成');
        } else {
          gitSpinner.info('无需提交，工作区干净');
        }
      } catch (err) {
        gitSpinner.warn('Git 提交失败（非致命）');
        console.error(err);
      }
    }
  });
