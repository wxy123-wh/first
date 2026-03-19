// Preflight 校验 — 管线执行前检查必要文件

import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { LisanError, LisanErrorCode } from '../errors/index.js';

export interface PreflightResult {
  ok: boolean;
  errors: string[];
}

/**
 * 检查 write 管线所需的前置文件
 * - scenes.md（场景树）
 * - chapter-plan.md（章节规划）
 */
export async function preflightCheck(
  projectRoot: string,
  chapterNumber: number,
): Promise<PreflightResult> {
  const errors: string[] = [];

  const requiredFiles = [
    { path: join(projectRoot, '场景树', 'scenes.md'), label: '场景树/scenes.md' },
    { path: join(projectRoot, '大纲', 'chapter-plan.md'), label: '大纲/chapter-plan.md' },
  ];

  for (const file of requiredFiles) {
    try {
      await access(file.path);
    } catch {
      errors.push(`缺少必要文件: ${file.label}`);
    }
  }

  // 检查 .lisan 目录
  try {
    await access(join(projectRoot, '.lisan'));
  } catch {
    errors.push('项目未初始化: 缺少 .lisan 目录，请先运行 lisan init');
  }

  if (errors.length > 0) {
    const nl = String.fromCharCode(10);
    const detail = errors.map((e) => `  - ${e}`).join(nl);
    throw new LisanError(
      `Preflight 校验失败 (chapter ${chapterNumber}):${nl}${detail}`,
      LisanErrorCode.PROJECT_NOT_INIT,
    );
  }

  return { ok: true, errors: [] };
}
