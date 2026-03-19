// 真相文件管理器 — 读取/更新 truth/ 目录下的连续性管控文件

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { TruthFiles, SettlementData } from './types.js';

const NL = String.fromCharCode(10);

// ---- 模板 ----

const CURRENT_STATE_TEMPLATE = [
  '# \u4e16\u754c\u72b6\u6001\u5feb\u7167',
  '> \u6700\u540e\u66f4\u65b0: \u521d\u59cb\u5316',
  '',
  '## \u4e3b\u89d2\u72b6\u6001',
  '- \u4f4d\u7f6e: \u672a\u8bbe\u5b9a',
  '- \u8eab\u4f53\u72b6\u6001: \u6b63\u5e38',
  '- \u6301\u6709\u7269\u54c1: \u65e0',
  '',
  '## \u5173\u952eNPC\u72b6\u6001',
  '| NPC | \u4f4d\u7f6e | \u72b6\u6001 | \u6700\u540e\u51fa\u73b0\u7ae0\u8282 |',
  '|-----|------|------|-------------|',
  '',
  '## \u52bf\u529b\u683c\u5c40',
  '',
  '## \u65f6\u95f4\u7ebf',
  '| \u7ae0\u8282 | \u65f6\u95f4 | \u4e8b\u4ef6 |',
  '|------|------|------|',
].join(NL);

const PENDING_HOOKS_TEMPLATE = [
  '# \u4f0f\u7b14\u8ffd\u8e2a\u8868',
  '> \u6700\u540e\u66f4\u65b0: \u521d\u59cb\u5316',
  '',
  '## \u6d3b\u8dc3\u4f0f\u7b14',
  '| \u7f16\u53f7 | \u63cf\u8ff0 | \u57cb\u8bbe\u7ae0\u8282 | \u9884\u8ba1\u56de\u6536 | \u6ede\u7559\u6807\u8bb0 |',
  '|------|------|---------|---------|---------|',
  '',
  '## \u5df2\u56de\u6536\u4f0f\u7b14',
  '| \u7f16\u53f7 | \u63cf\u8ff0 | \u57cb\u8bbe\u7ae0\u8282 | \u56de\u6536\u7ae0\u8282 |',
  '|------|------|---------|---------|',
].join(NL);

const CHARACTER_MATRIX_TEMPLATE = [
  '# \u89d2\u8272\u4ea4\u4e92\u77e9\u9635',
  '> \u6700\u540e\u66f4\u65b0: \u521d\u59cb\u5316',
  '',
  '## \u4fe1\u606f\u8fb9\u754c',
  '| \u89d2\u8272 | \u77e5\u9053\u4ec0\u4e48 | \u4e0d\u77e5\u9053\u4ec0\u4e48 |',
  '|------|---------|-----------|',
  '',
  '## \u5173\u7cfb\u72b6\u6001',
  '| \u89d2\u8272A | \u89d2\u8272B | \u5173\u7cfb | \u6700\u540e\u4ea4\u4e92\u7ae0\u8282 |',
  '|-------|-------|------|-------------|',
].join(NL);

/** 真相文件路径名 */
const FILE_NAMES = {
  currentState: 'current_state.md',
  pendingHooks: 'pending_hooks.md',
  characterMatrix: 'character_matrix.md',
} as const;

/**
 * TruthManager
 * 管理 truth/ 目录下的三个真相文件：
 * - current_state.md — 世界状态快照
 * - pending_hooks.md — 伏笔追踪表
 * - character_matrix.md — 角色交互矩阵
 */
export class TruthManager {
  private readonly truthDir: string;

  constructor(projectRoot: string, truthDir?: string) {
    this.truthDir = join(projectRoot, truthDir ?? 'truth');
  }

  /** 读取全部真相文件 */
  async read(): Promise<TruthFiles> {
    const [currentState, pendingHooks, characterMatrix] = await Promise.all([
      this.readFileOrDefault(FILE_NAMES.currentState, CURRENT_STATE_TEMPLATE),
      this.readFileOrDefault(FILE_NAMES.pendingHooks, PENDING_HOOKS_TEMPLATE),
      this.readFileOrDefault(FILE_NAMES.characterMatrix, CHARACTER_MATRIX_TEMPLATE),
    ]);
    return { currentState, pendingHooks, characterMatrix };
  }

  /** 生成注入 prompt 的真相摘要（限制 2000 字） */
  async buildSummary(): Promise<string> {
    const files = await this.read();
    const sections = [
      '[\u771f\u76f8\u6587\u4ef6\u6458\u8981]',
      '',
      '--- \u4e16\u754c\u72b6\u6001 ---',
      files.currentState,
      '',
      '--- \u4f0f\u7b14\u8ffd\u8e2a ---',
      files.pendingHooks,
      '',
      '--- \u89d2\u8272\u77e9\u9635 ---',
      files.characterMatrix,
    ];
    const full = sections.join(NL);
    if (full.length > 2000) {
      return full.slice(0, 1997) + '...';
    }
    return full;
  }

  /** 用结算数据更新真相文件 */
  async applySettlement(settlement: SettlementData, chapterNumber: number): Promise<void> {
    await mkdir(this.truthDir, { recursive: true });

    const files = await this.read();
    const chapterTag = '\u7b2c' + chapterNumber + '\u7ae0';

    // 更新世界状态
    files.currentState = this.applyWorldStateChanges(files.currentState, settlement, chapterTag);

    // 更新伏笔
    files.pendingHooks = this.applyHookChanges(files.pendingHooks, settlement, chapterNumber);

    // 更新角色矩阵
    files.characterMatrix = this.applyCharacterChanges(files.characterMatrix, settlement, chapterNumber);

    await Promise.all([
      writeFile(join(this.truthDir, FILE_NAMES.currentState), files.currentState, 'utf-8'),
      writeFile(join(this.truthDir, FILE_NAMES.pendingHooks), files.pendingHooks, 'utf-8'),
      writeFile(join(this.truthDir, FILE_NAMES.characterMatrix), files.characterMatrix, 'utf-8'),
    ]);
  }

  /** 扫描滞留伏笔（>10章未回收），返回标记数量 */
  async markStaleHooks(currentChapter: number): Promise<number> {
    const content = await this.readFileOrDefault(FILE_NAMES.pendingHooks, PENDING_HOOKS_TEMPLATE);
    const lines = content.split(NL);
    let marked = 0;

    const updated = lines.map((line) => {
      // 匹配活跃伏笔表格行: | 编号 | 描述 | 埋设章节 | 预计回收 | 滞留标记 |
      const match = line.match(/^\|\s*(\S+)\s*\|\s*(.+?)\s*\|\s*(\d+)\s*\|\s*(\S*)\s*\|\s*(\S*)\s*\|$/);
      if (!match) return line;

      const plantedChapter = parseInt(match[3], 10);
      if (isNaN(plantedChapter)) return line;

      const staleTag = match[5].trim();
      if (staleTag === '\u6ede\u7559' || staleTag === '\u6ede\u7559\u6807\u8bb0') return line; // 表头或已标记

      if (currentChapter - plantedChapter > 10) {
        marked++;
        return '| ' + match[1] + ' | ' + match[2] + ' | ' + match[3] + ' | ' + match[4] + ' | \u6ede\u7559 |';
      }
      return line;
    });

    if (marked > 0) {
      await mkdir(this.truthDir, { recursive: true });
      await writeFile(join(this.truthDir, FILE_NAMES.pendingHooks), updated.join(NL), 'utf-8');
    }

    return marked;
  }

  /** 创建 truth/ 目录和模板文件（用于 init 命令） */
  async initTemplates(): Promise<void> {
    await mkdir(this.truthDir, { recursive: true });
    await Promise.all([
      writeFile(join(this.truthDir, FILE_NAMES.currentState), CURRENT_STATE_TEMPLATE, 'utf-8'),
      writeFile(join(this.truthDir, FILE_NAMES.pendingHooks), PENDING_HOOKS_TEMPLATE, 'utf-8'),
      writeFile(join(this.truthDir, FILE_NAMES.characterMatrix), CHARACTER_MATRIX_TEMPLATE, 'utf-8'),
    ]);
  }

  // ---- 内部方法 ----

  private async readFileOrDefault(fileName: string, defaultContent: string): Promise<string> {
    try {
      return await readFile(join(this.truthDir, fileName), 'utf-8');
    } catch {
      return defaultContent;
    }
  }

  private applyWorldStateChanges(content: string, settlement: SettlementData, chapterTag: string): string {
    // 更新"最后更新"标记
    let updated = content.replace(/> \u6700\u540e\u66f4\u65b0:.+/, '> \u6700\u540e\u66f4\u65b0: ' + chapterTag);

    // 追加世界状态变动到时间线
    for (const change of settlement.worldStateChanges) {
      const row = '| ' + chapterTag + ' | - | ' + change.description + ' |';
      updated += NL + row;
    }

    // 追加升级事件
    for (const evt of settlement.upgradeEvents) {
      const row = '| ' + chapterTag + ' | - | [\u5347\u7ea7] ' + evt.type + ': ' + evt.description + ' |';
      updated += NL + row;
    }

    return updated;
  }

  private applyHookChanges(content: string, settlement: SettlementData, chapterNumber: number): string {
    let updated = content.replace(/> \u6700\u540e\u66f4\u65b0:.+/, '> \u6700\u540e\u66f4\u65b0: \u7b2c' + chapterNumber + '\u7ae0');

    for (const hook of settlement.hookChanges) {
      if (hook.action === 'plant') {
        // 新埋伏笔：追加到活跃伏笔表
        const hookId = hook.hookId ?? ('H' + chapterNumber + '-' + Date.now());
        const expected = hook.expectedResolution ? String(hook.expectedResolution) : '-';
        const row = '| ' + hookId + ' | ' + hook.description + ' | ' + chapterNumber + ' | ' + expected + ' |  |';
        // 插入到活跃伏笔表末尾（在"已回收伏笔"之前）
        const resolvedIdx = updated.indexOf('## \u5df2\u56de\u6536\u4f0f\u7b14');
        if (resolvedIdx > -1) {
          updated = updated.slice(0, resolvedIdx) + row + NL + NL + updated.slice(resolvedIdx);
        } else {
          updated += NL + row;
        }
      } else if (hook.action === 'resolve' && hook.hookId) {
        // 回收伏笔：从活跃表移到已回收表
        const lines = updated.split(NL);
        let removedRow = '';
        const filtered = lines.filter((line) => {
          if (line.includes('| ' + hook.hookId + ' |') || line.includes('| ' + hook.hookId! + ' ')) {
            // 检查是否在活跃伏笔区域
            removedRow = line;
            return false;
          }
          return true;
        });
        updated = filtered.join(NL);

        if (removedRow) {
          // 从活跃行提取信息
          const parts = removedRow.split('|').map((s) => s.trim()).filter(Boolean);
          const resolvedRow = '| ' + (parts[0] ?? hook.hookId) + ' | ' + (parts[1] ?? hook.description) + ' | ' + (parts[2] ?? '-') + ' | ' + chapterNumber + ' |';
          updated += NL + resolvedRow;
        }
      }
    }

    return updated;
  }

  private applyCharacterChanges(content: string, settlement: SettlementData, chapterNumber: number): string {
    let updated = content.replace(/> \u6700\u540e\u66f4\u65b0:.+/, '> \u6700\u540e\u66f4\u65b0: \u7b2c' + chapterNumber + '\u7ae0');

    for (const interaction of settlement.characterInteractions) {
      if (interaction.type === 'info_gain') {
        // 追加到信息边界表
        for (const char of interaction.characters) {
          const row = '| ' + char + ' | ' + interaction.description + ' |  |';
          // 插入到信息边界表末尾（在"关系状态"之前）
          const relationIdx = updated.indexOf('## \u5173\u7cfb\u72b6\u6001');
          if (relationIdx > -1) {
            updated = updated.slice(0, relationIdx) + row + NL + NL + updated.slice(relationIdx);
          } else {
            updated += NL + row;
          }
        }
      } else if (interaction.type === 'first_meet' || interaction.type === 'relation_change') {
        // 追加到关系状态表
        const chars = interaction.characters;
        if (chars.length >= 2) {
          const row = '| ' + chars[0] + ' | ' + chars[1] + ' | ' + interaction.description + ' | ' + chapterNumber + ' |';
          updated += NL + row;
        }
      }
    }

    return updated;
  }
}

// 导出模板常量（供 init 命令和测试使用）
export { CURRENT_STATE_TEMPLATE, PENDING_HOOKS_TEMPLATE, CHARACTER_MATRIX_TEMPLATE };
