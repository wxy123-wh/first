// lisan status 命令

import { Command } from 'commander';
import { FileStateManager } from '@lisan/core';

export const statusCommand = new Command('status')
  .description('查看项目进度')
  .action(async (_options: unknown, cmd: Command) => {
    const projectRoot = cmd.parent?.opts().project ?? process.cwd();
    const stateManager = new FileStateManager(projectRoot);

    try {
      const state = await stateManager.load();
      const chapters = Object.values(state.chapters);
      const done = chapters.filter((c) => c.status === 'done');
      const totalWords = done.reduce((sum, c) => sum + (c.wordCount ?? 0), 0);

      console.log(`📖 ${state.bookId || '未命名项目'}`);
      console.log(`   当前弧线: ${state.currentArc || '未设置'}`);
      console.log(`   章节进度: ${done.length}/${chapters.length} 完成`);
      console.log(`   总字数: ${totalWords.toLocaleString()}`);

      // TODO: 展示待审查角色列表
      // TODO: 展示 token/成本统计
    } catch {
      console.log('⚠️  未找到项目状态，请先运行 lisan init');
    }
  });
