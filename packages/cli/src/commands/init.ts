// lisan init 命令

import { Command } from 'commander';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { TruthManager } from '@lisan/core';

export const initCommand = new Command('init')
  .argument('[dir]', '项目目录', '.')
  .description('初始化新项目')
  .action(async (dir: string) => {
    const root = join(process.cwd(), dir);

    // 创建标准目录结构
    const dirs = [
      '大纲',
      '设定集',
      '场景树',
      '正文',
      '.lisan/tmp',
      '.lisan/observability',
    ];

    for (const d of dirs) {
      await mkdir(join(root, d), { recursive: true });
    }

    // 创建真相文件模板
    const truthManager = new TruthManager(root);
    await truthManager.initTemplates();

    // 创建默认配置文件
    const defaultConfig = `version: "1"
book:
  id: "my-novel"
  title: "书名"
  plugin: "webnovel"

llm:
  orchestrator:
    provider: anthropic
    model: claude-opus-4-6
    temperature: 0.7
  worker:
    provider: openai
    model: gpt-4o
    temperature: 0.85

rag:
  provider: lancedb
  embedModel: text-embedding-v3
  embedBaseUrl: \${EMBED_BASE_URL}
  embedApiKey: \${EMBED_API_KEY}

pipeline:
  write:
    chapterWordRange: [3000, 4000]
    passes: [pass-1, pass-2, pass-3, pass-4, pass-5]
    autoGitCommit: true
`;

    await writeFile(join(root, 'lisan.config.yaml'), defaultConfig, 'utf-8');
    const defaultOutline = `# 第一卷大纲

## 主线
- 主角在压迫环境中被迫成长
- 关键冲突逐步升级并在卷末形成爆点
`;
    await writeFile(join(root, '大纲', 'arc-1.md'), defaultOutline, 'utf-8');
    console.log(`✅ 项目已初始化: ${root}`);
  });
