// @lisan/cli — CLI 入口

import { Command } from 'commander';
import { initCommand } from './commands/init.js';
import { writeCommand } from './commands/write.js';
import { statusCommand } from './commands/status.js';
import { decomposeCommand } from './commands/decompose.js';
import { planCommand } from './commands/plan.js';
import { rewriteCommand } from './commands/rewrite.js';
import { syncCommand } from './commands/sync.js';

const program = new Command();

program
  .name('lisan')
  .description('AI 驱动的网文写作 CLI 工具')
  .version('0.1.0');

// 全局选项
program
  .option('-p, --project <path>', '项目根目录', process.cwd())
  .option('--verbose', '输出详细日志', false);

// 注册子命令
program.addCommand(initCommand);
program.addCommand(decomposeCommand);
program.addCommand(planCommand);
program.addCommand(writeCommand);
program.addCommand(rewriteCommand);
program.addCommand(syncCommand);
program.addCommand(statusCommand);

program.parse();
